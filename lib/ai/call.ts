import "server-only";
import { GoogleGenAI, type GoogleGenAIInteraction as Interaction } from "@google/genai";
import type { z } from "zod";
import { ConfigError, serverEnv } from "@/lib/env";
import { MAX_TOKENS, MODELS, type ModelTask, THINKING } from "./config";
import {
  classifyApiError,
  KEY_PROBLEM_KINDS,
  MISSING_KEY_MESSAGE,
  type ModelFailureKind,
  RETRYABLE_KINDS,
} from "./errors";
import { parseModelJson } from "./json";
import { type JsonSchema, toGeminiSchema } from "./json-schema";
import { type BillingTier, estimateCostUsd } from "./pricing";

export type { ModelFailureKind } from "./errors";

// Every model call goes through generateJson. It owns retrying (the SDK's own retries
// are off so retries can be counted), turns interaction statuses and API errors into typed
// failures, and parses and validates the JSON reply.
//
// Calls use Gemini's Interactions API with store: false, so Google keeps no copy of the
// conversation for later retrieval; MockBuddy never needs server-side conversation state.

export interface CallMetrics {
  label: string;
  model: string;
  /** The model that answered, as the API reports it. */
  servedBy: string | null;
  attempts: number;
  retries429: number;
  retriesOther: number;
  waitedMs: number;
  durationMs: number;
  /** Prompt tokens that weren't served from Gemini's implicit cache. */
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cacheReadTokens: number;
  /** The interaction's final status: "completed", "incomplete", "failed"… */
  stopReason: string | null;
  billingTier: BillingTier;
  /** 0 on the free tier; from list prices otherwise; null when the call failed before any usage. */
  estimatedCostUsd: number | null;
}

export class ModelCallError extends Error {
  override name = "ModelCallError";
  constructor(
    readonly kind: ModelFailureKind,
    message: string,
    readonly metrics: CallMetrics,
    readonly details: {
      issues?: string[];
      rawText?: string;
      retryAfterMs?: number;
      httpStatus?: number;
      quotaIds?: string[];
      /** For the log only: Google's own reason, or a hint for the site owner. */
      detail?: string;
    } = {},
  ) {
    super(message);
  }

  /** True when running the same request again later may succeed. */
  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }

  /** True when the server's API key is missing or invalid, or its quota is used up: fix that, then retry. */
  get keyProblem(): boolean {
    return KEY_PROBLEM_KINDS.has(this.kind);
  }
}

/** One block of prompt text. */
export interface PromptText {
  type: "text";
  text: string;
}

/** Every call is a single user turn; a retry appends to it rather than replaying a model turn. */
export interface PromptMessage {
  role: "user";
  content: string | PromptText[];
}

export interface JsonCall<S extends z.ZodType> {
  /** Logged with the metrics, e.g. { label: "draft", examId, batch }. */
  context: { label: string } & Record<string, string | number | undefined>;
  schema: S;
  system: string;
  messages: PromptMessage[];
  /** Picks the model, thinking level and output cap from lib/ai/config.ts. */
  task: ModelTask;
  /** Epoch ms by which the call must have finished (set on Vercel only). */
  deadlineAt?: number;
}

export interface JsonResult<T> {
  data: T;
  rawText: string;
  metrics: CallMetrics;
}

const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 20_000;
/** Don't start an attempt with less time than this left before the deadline. */
const MIN_ATTEMPT_MS = 8_000;
/** Per-attempt limit when no request deadline applies (locally). */
const LOCAL_TIMEOUT_MS = 600_000;

export async function generateJson<S extends z.ZodType>(call: JsonCall<S>): Promise<JsonResult<z.output<S>>> {
  const started = Date.now();
  const metrics: CallMetrics = {
    label: call.context.label,
    model: MODELS[call.task],
    servedBy: null,
    attempts: 0,
    retries429: 0,
    retriesOther: 0,
    waitedMs: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cacheReadTokens: 0,
    stopReason: null,
    billingTier: serverEnv("GEMINI_TIER"),
    estimatedCostUsd: null,
  };
  const finish = (outcome: string, extra: Record<string, unknown> = {}) => {
    metrics.durationMs = Date.now() - started;
    console.log(JSON.stringify({ event: "model_call", outcome, task: call.task, thinking: THINKING[call.task], ...call.context, ...metrics, ...extra }));
  };

  let interaction: Interaction;
  try {
    interaction = await sendWithRetries(call, metrics);
  } catch (error) {
    if (error instanceof ModelCallError) {
      finish(error.kind, {
        error: error.message,
        httpStatus: error.details.httpStatus,
        quotaIds: error.details.quotaIds,
        retryAfterMs: error.details.retryAfterMs,
        detail: error.details.detail,
      });
    } else {
      finish("unexpected_error", { error: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  }

  const usage = interaction.usage ?? {};
  const cached = usage.total_cached_tokens ?? 0;
  metrics.servedBy = interaction.model ?? null;
  metrics.stopReason = interaction.status;
  metrics.inputTokens = Math.max(0, (usage.total_input_tokens ?? 0) - cached);
  metrics.cacheReadTokens = cached;
  metrics.outputTokens = usage.total_output_tokens ?? 0;
  metrics.thoughtTokens = usage.total_thought_tokens ?? 0;
  metrics.estimatedCostUsd = estimateCostUsd(metrics.servedBy ?? metrics.model, metrics, metrics.billingTier);

  const fail = (kind: ModelFailureKind, text: string, details: ModelCallError["details"] = {}): never => {
    finish(kind, { error: text });
    throw new ModelCallError(kind, text, metrics, details);
  };

  const rawText = interaction.output_text ?? "";
  if (interaction.status === "incomplete") {
    fail(
      "max_tokens",
      `The response was cut off at the ${MAX_TOKENS[call.task]}-token limit (thinking counts toward it) before the JSON was complete.`,
      { rawText },
    );
  }
  if (interaction.status === "failed") {
    const reasons = (interaction.errors ?? []).map((e) => e.message ?? e.code ?? "").filter(Boolean).join("; ") || "no reason given";
    const safety = /safety|blocked|prohibited|recitation|policy/i.test(reasons);
    fail(safety ? "refusal" : "api", safety ? `The model declined this request: ${reasons}` : `The model call failed: ${reasons}`);
  }
  if (interaction.status !== "completed") fail("api", `The model call ended with status "${interaction.status}".`, { rawText });

  const parsed = parseModelJson(rawText);
  if (!parsed.ok) fail("invalid_output", parsed.error, { issues: [parsed.error], rawText });
  const validated = call.schema.safeParse((parsed as { ok: true; value: unknown }).value);
  if (!validated.success) {
    const issues = validated.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    fail("invalid_output", `The response did not match the schema: ${issues.slice(0, 3).join("; ")}`, { issues, rawText });
  }

  finish("ok");
  return { data: validated.data as z.output<S>, rawText, metrics };
}

/**
 * generateJson plus the spec's validation rule: if the reply fails the schema or
 * `validate`, ask once more with the problems listed; if that fails too, throw.
 */
export async function generateValidatedJson<S extends z.ZodType>(
  call: JsonCall<S>,
  validate: (data: z.output<S>) => string[],
): Promise<{ data: z.output<S>; calls: CallMetrics[] }> {
  const calls: CallMetrics[] = [];
  let messages = call.messages;
  for (let round = 1; ; round++) {
    let issues: string[];
    let rawText: string;
    try {
      const result = await generateJson({ ...call, messages, context: { ...call.context, round } });
      calls.push(result.metrics);
      issues = validate(result.data);
      if (issues.length === 0) return { data: result.data, calls };
      rawText = result.rawText;
    } catch (error) {
      if (!(error instanceof ModelCallError) || error.kind !== "invalid_output") throw error;
      calls.push(error.metrics);
      issues = error.details.issues ?? [error.message];
      rawText = error.details.rawText ?? "";
    }
    if (round === 2) {
      throw new ModelCallError(
        "invalid_output",
        `The response was still invalid after one retry: ${issues.slice(0, 3).join("; ")}`,
        calls[calls.length - 1],
        { issues },
      );
    }
    messages = withRetryNote(call.messages, rawText, issues);
  }
}

/**
 * Appends the failed reply and its problems to the last user message. The retry is a
 * fresh single-turn request rather than a replayed model turn, so there is no prior
 * model output (or thinking) in the history.
 */
export function withRetryNote(messages: PromptMessage[], previousResponse: string, issues: string[]): PromptMessage[] {
  const last = messages[messages.length - 1];
  if (!last) throw new Error("withRetryNote expects the conversation to end with a user message.");
  const note: PromptText = {
    type: "text",
    text: [
      "A previous attempt at this task returned:",
      "<previous_response>",
      previousResponse || "(nothing)",
      "</previous_response>",
      "It had these problems:",
      ...issues.map((issue) => `- ${issue}`),
      "Return the complete JSON object again with every problem fixed. Keep everything that was already correct.",
    ].join("\n"),
  };
  return [...messages.slice(0, -1), { role: "user", content: [...textBlocks(last.content), note] }];
}

function textBlocks(content: PromptMessage["content"]): PromptText[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

async function sendWithRetries<S extends z.ZodType>(call: JsonCall<S>, metrics: CallMetrics): Promise<Interaction> {
  const schema = outputSchema(call.schema);
  for (;;) {
    metrics.attempts++;
    const remaining = call.deadlineAt === undefined ? undefined : call.deadlineAt - Date.now();
    if (remaining !== undefined && remaining < MIN_ATTEMPT_MS) {
      throw new ModelCallError("deadline", "Not enough time left in this request for another model call.", metrics, {
        retryAfterMs: 0,
      });
    }

    try {
      return await client().interactions.create(
        {
          model: MODELS[call.task],
          system_instruction: call.system,
          input: call.messages.flatMap((message) => textBlocks(message.content)),
          store: false,
          generation_config: { max_output_tokens: MAX_TOKENS[call.task], thinking_level: THINKING[call.task] },
          response_format: { type: "text", mime_type: "application/json", schema },
        },
        { retries: { strategy: "none" }, timeout_ms: remaining ?? LOCAL_TIMEOUT_MS },
      );
    } catch (error) {
      const failure = classify(error, call, metrics);
      if (!failure.retryable) throw failure;

      const delay = backoffMs(metrics.attempts, failure.details.retryAfterMs);
      const wouldOverrun = call.deadlineAt !== undefined && Date.now() + delay + MIN_ATTEMPT_MS > call.deadlineAt;
      if (metrics.attempts >= MAX_ATTEMPTS || wouldOverrun) throw failure;

      if (failure.kind === "rate_limited") metrics.retries429++;
      else metrics.retriesOther++;
      metrics.waitedMs += delay;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function classify<S extends z.ZodType>(error: unknown, call: JsonCall<S>, metrics: CallMetrics): ModelCallError {
  if (error instanceof ConfigError) return new ModelCallError("missing_key", MISSING_KEY_MESSAGE, metrics, { detail: error.message });
  if (
    error instanceof Error &&
    error.name === "APIConnectionTimeoutError" &&
    call.deadlineAt !== undefined &&
    Date.now() >= call.deadlineAt - 1_000
  ) {
    return new ModelCallError("deadline", "The model call ran out of time in this request.", metrics, { retryAfterMs: 0 });
  }
  const classified = classifyApiError(error, metrics, process.env.GEMINI_API_KEY);
  if (!classified) throw error;
  return new ModelCallError(classified.kind, classified.message, metrics, {
    retryAfterMs: classified.retryAfterMs,
    httpStatus: classified.httpStatus,
    quotaIds: classified.quotaIds,
    detail: classified.detail,
  });
}

function backoffMs(attempt: number, retryAfter: number | undefined): number {
  if (retryAfter !== undefined && retryAfter > 0) return Math.round(Math.min(retryAfter + Math.random() * 250, 60_000));
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (attempt - 1));
  return Math.round(base / 2 + Math.random() * (base / 2));
}

const schemas = new WeakMap<z.ZodType, JsonSchema>();

/** The structured-output JSON Schema for a Zod schema, built once per schema. */
function outputSchema(schema: z.ZodType): JsonSchema {
  let converted = schemas.get(schema);
  if (!converted) {
    converted = toGeminiSchema(schema);
    schemas.set(schema, converted);
  }
  return converted;
}

/** The JSON Schema text for a Zod schema, for including in prompts. */
export function schemaText(schema: z.ZodType): string {
  return JSON.stringify(outputSchema(schema), null, 2);
}

const globalForGemini = globalThis as unknown as { mockbuddyGemini?: GoogleGenAI };

/**
 * One client per server instance, with the server's key (GEMINI_API_KEY), which never
 * leaves the server. The key is passed explicitly, so the SDK never falls back to a
 * GOOGLE_API_KEY from the environment.
 */
function client(): GoogleGenAI {
  globalForGemini.mockbuddyGemini ??= new GoogleGenAI({ apiKey: serverEnv("GEMINI_API_KEY") });
  return globalForGemini.mockbuddyGemini;
}
