import type { ApiKey } from "../api-key.ts";

// Turns Gemini API errors into failure kinds with messages the student can act on.
// Missing key, invalid key, quota exceeded and rate limited each get their own kind and
// wording, so the UI can tell them apart. Messages never include the key itself.
//
// The SDK doesn't export its error classes for the Interactions API, so errors are
// recognised by shape: a `status`, the response `headers`, and the API's error body
// (google.rpc.Status, with details such as ErrorInfo, QuotaFailure and RetryInfo).

export type ModelFailureKind =
  | "missing_key"
  | "invalid_key"
  | "quota_exceeded"
  | "rate_limited"
  | "overloaded"
  | "unavailable"
  | "deadline"
  | "refusal"
  | "max_tokens"
  | "invalid_output"
  | "api";

/** Worth running the same request again later. */
export const RETRYABLE_KINDS: ReadonlySet<ModelFailureKind> = new Set(["rate_limited", "overloaded", "unavailable", "deadline"]);

/**
 * The key, or the quota behind it, has to be fixed before anything can work; retrying the
 * same request now won't help. Work in progress stays where it is until then.
 */
export const KEY_PROBLEM_KINDS: ReadonlySet<ModelFailureKind> = new Set(["missing_key", "invalid_key", "quota_exceeded"]);

export interface ClassifiedError {
  kind: ModelFailureKind;
  message: string;
  retryAfterMs?: number;
}

export const MISSING_KEY_MESSAGE =
  "No Gemini API key. Paste your own key in the API key field at /app, or set GEMINI_API_KEY in .env.local.";

export function whoseKey(key: ApiKey): string {
  return key.source === "browser" ? "the API key you pasted" : "GEMINI_API_KEY from .env.local";
}

/** google.rpc.Status, the body of every Gemini API error. */
interface RpcStatus {
  code?: number;
  message?: string;
  status?: string;
  details?: RpcDetail[];
}

interface RpcDetail {
  "@type"?: string;
  reason?: string;
  retryDelay?: string;
  violations?: { quotaId?: string; quotaMetric?: string }[];
}

interface SdkHttpError extends Error {
  status: number;
  headers?: Headers;
  error?: unknown;
}

/** Null when `error` is not an error from the Gemini SDK. */
export function classifyApiError(error: unknown, key: ApiKey, context: { attempts: number; retries429: number }): ClassifiedError | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "APIConnectionTimeoutError") return { kind: "unavailable", message: "The model call timed out." };
  if (error.name === "APIConnectionError" || error.name === "APIUserAbortError") {
    return { kind: "unavailable", message: `Couldn't reach the Gemini API: ${error.message}` };
  }
  if (!isHttpError(error)) return null;

  const rpc = rpcStatus(error);
  const detail = rpc.message ?? error.message;
  const reasons = (rpc.details ?? []).flatMap((d) => (d.reason ? [d.reason] : []));
  const quotaIds = (rpc.details ?? []).flatMap((d) => d.violations ?? []).flatMap((v) => (v.quotaId ? [v.quotaId] : []));
  const retryAfter = retryDelayMs(rpc) ?? retryAfterMs(error.headers);

  if (reasons.some((r) => r.startsWith("API_KEY_")) || /api key not valid|api key expired/i.test(detail)) {
    return {
      kind: "invalid_key",
      message:
        key.source === "browser"
          ? "Google rejected the API key you pasted: it's wrong, expired or has been deleted. Clear it at /app and paste a valid key from Google AI Studio."
          : "Google rejected GEMINI_API_KEY from .env.local: it's wrong, expired or has been deleted. Fix it in .env.local, or paste a valid key at /app.",
    };
  }
  if (/leaked/i.test(detail)) {
    return {
      kind: "invalid_key",
      message: `Google has blocked ${whoseKey(key)} because it was reported as leaked. Create a new key in Google AI Studio and use that instead.`,
    };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      kind: "invalid_key",
      message: `Google refused ${whoseKey(key)} for this request (HTTP ${error.status}): ${detail} The key's project may not have the Gemini API enabled or may not have access to this model.`,
    };
  }

  if (error.status === 429) {
    const daily = quotaIds.some((id) => /PerDay/i.test(id));
    const noFreeQuota = /limit:\s*0\b/.test(detail);
    const spendCap = /spend|billing|prepa(y|id)|credits?\b/i.test(detail) && quotaIds.length === 0;
    if (daily || noFreeQuota || spendCap) {
      const why = noFreeQuota
        ? "has no quota for this model (it may not be on the free tier)"
        : daily
          ? "has used up today's requests for this model. Free-tier daily limits reset at midnight Pacific time"
          : "has reached its spending limit";
      return {
        kind: "quota_exceeded",
        message: `The Google project behind ${whoseKey(key)} ${why}. Check the rate-limit page in Google AI Studio, wait for the reset, or use a key with billing enabled. Google said: ${firstLine(detail)}`,
      };
    }
    return {
      kind: "rate_limited",
      message: `Rate limited by Gemini (HTTP 429): still limited after ${context.attempts} attempt(s) and ${context.retries429} automatic retries. Wait a minute and try again; free-tier keys allow only a few requests per minute.`,
      retryAfterMs: retryAfter,
    };
  }

  if (error.status === 400 && rpc.status === "FAILED_PRECONDITION" && /free tier|billing/i.test(detail)) {
    return {
      kind: "quota_exceeded",
      message: `The Gemini free tier isn't available for the project behind ${whoseKey(key)} here. Enable billing on the project in Google AI Studio, or use a key that has it. Google said: ${firstLine(detail)}`,
    };
  }
  if (error.status === 503) return { kind: "overloaded", message: "The Gemini model is overloaded (HTTP 503).", retryAfterMs: retryAfter };
  if (error.status >= 500) return { kind: "unavailable", message: `The Gemini API failed (HTTP ${error.status}).`, retryAfterMs: retryAfter };
  if (error.status === 404) {
    return { kind: "api", message: `Gemini doesn't know this model (HTTP 404): ${detail} Check MODELS in lib/ai/config.ts.` };
  }
  return { kind: "api", message: `The Gemini API rejected the request (HTTP ${error.status}): ${detail}` };
}

function isHttpError(error: Error): error is SdkHttpError {
  return typeof (error as Partial<SdkHttpError>).status === "number" && "error" in error;
}

/** The SDK wraps the body as { error: Status } (sometimes inside its own { error } envelope). */
function rpcStatus(error: SdkHttpError): RpcStatus {
  let body = error.error as { error?: unknown } | undefined;
  for (let depth = 0; depth < 2 && body && typeof body === "object" && "error" in body && typeof body.error === "object"; depth++) {
    body = body.error as { error?: unknown };
  }
  return body && typeof body === "object" ? (body as RpcStatus) : {};
}

function firstLine(text: string): string {
  return text.split("\n")[0].trim();
}

/** RetryInfo.retryDelay, e.g. "37s" or "1.5s". */
function retryDelayMs(rpc: RpcStatus): number | undefined {
  for (const detail of rpc.details ?? []) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay ?? "");
    if (match) return Math.round(Number(match[1]) * 1_000);
  }
  return undefined;
}

export function retryAfterMs(headers: Headers | undefined): number | undefined {
  const seconds = Number(headers?.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}
