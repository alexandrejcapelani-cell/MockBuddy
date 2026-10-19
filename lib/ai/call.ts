import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ApiKey } from "@/lib/api-key";
import { ConfigError, serverEnv } from "@/lib/env";
import { MODEL } from "./config";
import {
  classifyApiError,
  KEY_PROBLEM_KINDS,
  MISSING_KEY_MESSAGE,
  type ModelFailureKind,
  RETRYABLE_KINDS,
} from "./errors";
import { parseModelJson } from "./json";

export type { ModelFailureKind } from "./errors";

// Every model call goes through generateJson. It owns retrying (the SDK's own retries
// are off so retries can be counted), turns stop reasons and API errors into typed
// failures, and parses and validates the JSON reply.

export type Effort = "low" | "medium" | "high";

export interface CallMetrics {
  label: string;
  model: string;
  /** The model that actually answered; differs from `model` when a refusal fallback ran. */
  servedBy: string | null;
  attempts: number;
  retries429: number;
  retriesOther: number;
  waitedMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  stopReason: string | null;
}

export class ModelCallError extends Error {
  override name = "ModelCallError";
  constructor(
    readonly kind: ModelFailureKind,
    message: string,
    readonly metrics: CallMetrics,
    readonly details: { issues?: string[]; rawText?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
  }

  /** True when running the same request again later may succeed. */
  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }

  /** True when the API key is missing, invalid or out of credits: fix the key, then retry. */
  get keyProblem(): boolean {
    return KEY_PROBLEM_KINDS.has(this.kind);
  }
}

export interface JsonCall<S extends z.ZodType> {
  /** Logged with the metrics, e.g. { label: "draft", examId, batch }. */
  context: { label: string } & Record<string, string | number | undefined>;
  schema: S;
  system: Anthropic.Beta.Messages.BetaTextBlockParam[];
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  effort: Effort;
  maxTokens: number;
  /** Epoch ms by which the call must have finished (set on Vercel only). */
  deadlineAt?: number;
  /** The key for this call. A browser key is used for this call only: never stored or logged. */
  apiKey: ApiKey;
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

export async function generateJson<S extends z.ZodType>(call: JsonCall<S>): Promise<JsonResult<z.output<S>>> {
  const started = Date.now();
  const metrics: CallMetrics = {
    label: call.context.label,
    model: MODEL,
    servedBy: null,
    attempts: 0,
    retries429: 0,
    retriesOther: 0,
    waitedMs: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    stopReason: null,
  };
  const finish = (outcome: string, extra: Record<string, unknown> = {}) => {
    metrics.durationMs = Date.now() - started;
    console.log(JSON.stringify({ event: "model_call", outcome, ...call.context, ...metrics, ...extra }));
  };

  let message: Anthropic.Beta.Messages.BetaMessage;
  try {
    message = await sendWithRetries(call, metrics);
  } catch (error) {
    if (error instanceof ModelCallError) finish(error.kind, { error: error.message });
    else finish("unexpected_error", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }

  metrics.servedBy = message.model;
  metrics.stopReason = message.stop_reason;
  metrics.inputTokens = message.usage.input_tokens;
  metrics.outputTokens = message.usage.output_tokens;
  metrics.cacheReadTokens = message.usage.cache_read_input_tokens ?? 0;
  metrics.cacheWriteTokens = message.usage.cache_creation_input_tokens ?? 0;

  const fail = (kind: ModelFailureKind, text: string, details: ModelCallError["details"] = {}): never => {
    finish(kind, { error: text });
    throw new ModelCallError(kind, text, metrics, details);
  };

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "unspecified";
    fail("refusal", `The model declined this request (safety category: ${category}), and the fallback model declined too.`);
  }
  const rawText = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  if (message.stop_reason === "max_tokens") {
    fail("max_tokens", `The response was cut off at the ${call.maxTokens}-token limit before the JSON was complete.`, { rawText });
  }

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
 * fresh single-turn request rather than a replayed assistant turn, so there is no prior
 * assistant output (or thinking) in the history.
 */
export function withRetryNote(
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
  previousResponse: string,
  issues: string[],
): Anthropic.Beta.Messages.BetaMessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") throw new Error("withRetryNote expects the conversation to end with a user message.");
  const note: Anthropic.Beta.Messages.BetaTextBlockParam = {
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
  const content = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
  return [...messages.slice(0, -1), { role: "user", content: [...content, note] }];
}

async function sendWithRetries<S extends z.ZodType>(
  call: JsonCall<S>,
  metrics: CallMetrics,
): Promise<Anthropic.Beta.Messages.BetaMessage> {
  const format = outputFormat(call.schema);
  for (;;) {
    metrics.attempts++;
    const remaining = call.deadlineAt === undefined ? undefined : call.deadlineAt - Date.now();
    if (remaining !== undefined && remaining < MIN_ATTEMPT_MS) {
      throw new ModelCallError("deadline", "Not enough time left in this request for another model call.", metrics, {
        retryAfterMs: 0,
      });
    }

    try {
      const stream = clientFor(call.apiKey).beta.messages.stream(
        {
          model: MODEL,
          max_tokens: call.maxTokens,
          system: call.system,
          messages: call.messages,
          output_config: { effort: call.effort, format },
          // If Sonnet declines for policy reasons, the API re-runs the request on its
          // default fallback model inside the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        remaining === undefined ? {} : { timeout: remaining },
      );
      return await stream.finalMessage();
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
  if (error instanceof ConfigError) return new ModelCallError("missing_key", MISSING_KEY_MESSAGE, metrics);
  if (
    error instanceof Anthropic.APIConnectionTimeoutError &&
    call.deadlineAt !== undefined &&
    Date.now() >= call.deadlineAt - 1_000
  ) {
    return new ModelCallError("deadline", "The model call ran out of time in this request.", metrics, { retryAfterMs: 0 });
  }
  const classified = classifyApiError(error, call.apiKey, metrics);
  if (!classified) throw error;
  return new ModelCallError(classified.kind, classified.message, metrics, { retryAfterMs: classified.retryAfterMs });
}

function backoffMs(attempt: number, retryAfter: number | undefined): number {
  if (retryAfter !== undefined && retryAfter > 0) return Math.min(retryAfter + Math.random() * 250, 60_000);
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (attempt - 1));
  return Math.round(base / 2 + Math.random() * (base / 2));
}

const formats = new WeakMap<z.ZodType, { type: "json_schema"; schema: Record<string, unknown> }>();

/** The JSON Schema output format for a Zod schema, built once per schema. */
function outputFormat(schema: z.ZodType) {
  let format = formats.get(schema);
  if (!format) {
    const built = zodOutputFormat(schema);
    format = { type: "json_schema", schema: built.schema };
    formats.set(schema, format);
  }
  return format;
}

/** The JSON Schema text for a Zod schema, for including in prompts. */
export function schemaText(schema: z.ZodType): string {
  return JSON.stringify(outputFormat(schema).schema, null, 2);
}

const globalForAnthropic = globalThis as unknown as { mockbuddyAnthropic?: Anthropic };

/**
 * The server's own client (ANTHROPIC_API_KEY) is cached. A key pasted in the browser gets a
 * client for this call only, so it is never kept in memory beyond the request.
 */
function clientFor(apiKey: ApiKey): Anthropic {
  if (apiKey.source === "browser") return new Anthropic({ apiKey: apiKey.value, maxRetries: 0 });
  globalForAnthropic.mockbuddyAnthropic ??= new Anthropic({ apiKey: serverEnv("ANTHROPIC_API_KEY"), maxRetries: 0 });
  return globalForAnthropic.mockbuddyAnthropic;
}
