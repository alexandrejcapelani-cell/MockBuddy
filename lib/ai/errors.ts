// Turns Gemini API errors into failure kinds with messages a student can act on.
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
 * The server's key, or the quota behind it, has to be fixed (or reset) before anything can
 * work; retrying the same request now won't help. Work in progress stays where it is.
 */
export const KEY_PROBLEM_KINDS: ReadonlySet<ModelFailureKind> = new Set(["missing_key", "invalid_key", "quota_exceeded"]);

export interface ClassifiedError {
  kind: ModelFailureKind;
  message: string;
  retryAfterMs?: number;
  /** For the server log only; never shown. */
  httpStatus?: number;
}

export const MISSING_KEY_MESSAGE =
  "MockBuddy's AI isn't set up on this server yet, so generating and marking are unavailable. (Site owner: set GEMINI_API_KEY.)";

/** Google rejected the server's key: nothing the student can fix. */
const KEY_PROBLEM =
  "MockBuddy's AI service rejected our key, so generating and marking are unavailable right now. This is on our side, not yours; everything you've made is saved.";

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

/**
 * Null when `error` is not an error from the Gemini SDK. `secret` is the server's API key,
 * cut out of anything Google echoes back. Messages are for students: they say what went
 * wrong and what to do, and keep HTTP codes to the logs. The key belongs to the site, so a
 * key problem is never presented as the student's to fix.
 */
export function classifyApiError(error: unknown, context: { attempts: number; retries429: number }, secret?: string): ClassifiedError | null {
  if (!(error instanceof Error)) return null;
  // The SDK refuses Live-API ephemeral tokens (auth_tokens/…) itself, before sending anything.
  if (/ephemeral tokens are only supported/i.test(error.message)) {
    return { kind: "invalid_key", message: `${KEY_PROBLEM} (GEMINI_API_KEY is an ephemeral Live-API token, not an API key.)` };
  }
  if (error.name === "APIConnectionTimeoutError") return { kind: "unavailable", message: "The AI service took too long to answer. Try again." };
  if (error.name === "APIConnectionError" || error.name === "APIUserAbortError") {
    return { kind: "unavailable", message: "Couldn't reach the AI service. Check your connection and try again." };
  }
  if (!isHttpError(error)) return null;
  const classified = classifyHttpError(error, context, secret);
  return { ...classified, httpStatus: error.status };
}

function classifyHttpError(error: SdkHttpError, context: { attempts: number; retries429: number }, secret?: string): ClassifiedError {
  const rpc = rpcStatus(error);
  const detail = redactKey(rpc.message ?? error.message, secret);
  const reasons = (rpc.details ?? []).flatMap((d) => (d.reason ? [d.reason] : []));
  const quotaIds = (rpc.details ?? []).flatMap((d) => d.violations ?? []).flatMap((v) => (v.quotaId ? [v.quotaId] : []));
  const retryAfter = retryDelayMs(rpc) ?? retryAfterMs(error.headers);
  const google = `Google said: ${firstLine(detail)}`;

  if (error.status === 401 || reasons.some((r) => r.startsWith("API_KEY_")) || /api key not valid|api key expired/i.test(detail)) {
    return { kind: "invalid_key", message: `${KEY_PROBLEM} ${google}` };
  }
  if (/leaked/i.test(detail)) {
    return { kind: "invalid_key", message: `${KEY_PROBLEM} (Google blocked the key as leaked; it needs replacing.)` };
  }
  if (error.status === 403) {
    return {
      kind: "invalid_key",
      message: `${KEY_PROBLEM} ${google} (Google rejects unrestricted standard keys and long-unused ones; the key's project may also lack the Gemini API.)`,
    };
  }

  if (error.status === 429) {
    const daily = quotaIds.some((id) => /PerDay/i.test(id));
    const noFreeQuota = /limit:\s*0\b/.test(detail);
    const spendCap = /spend|billing|prepa(y|id)|credits?\b/i.test(detail) && quotaIds.length === 0;
    if (daily || noFreeQuota || spendCap) {
      const why = noFreeQuota
        ? "MockBuddy's AI plan doesn't include this model right now"
        : daily
          ? "MockBuddy has used up today's AI allowance. It resets at midnight Pacific time (09:00 in Spain), so try again then"
          : "MockBuddy has reached its AI spending limit for now";
      return { kind: "quota_exceeded", message: `${why}. Everything you've made is saved. ${google}` };
    }
    return {
      kind: "rate_limited",
      message: `The AI service is busy (still busy after ${context.attempts} attempt(s) and ${context.retries429} automatic retries). Wait a minute and try again.`,
      retryAfterMs: retryAfter,
    };
  }

  if (error.status === 400 && rpc.status === "FAILED_PRECONDITION" && /free tier|billing/i.test(detail)) {
    return { kind: "quota_exceeded", message: `MockBuddy's AI plan isn't available from this region right now. ${google}` };
  }
  if (error.status === 503) {
    return { kind: "overloaded", message: "The AI model is overloaded right now. Wait a moment and try again.", retryAfterMs: retryAfter };
  }
  if (error.status >= 500) return { kind: "unavailable", message: "The AI service had a problem. Try again in a moment.", retryAfterMs: retryAfter };
  if (error.status === 404) {
    return { kind: "api", message: `The AI model MockBuddy asked for isn't available. ${google} (Check MODELS in lib/ai/config.ts.)` };
  }
  return { kind: "api", message: `The AI service refused the request. ${google}` };
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

/**
 * Google's messages can quote the key (e.g. "Consumer 'api_key:…' has been suspended"), and
 * these messages are shown and logged, so the key is cut out before anything uses them.
 */
function redactKey(text: string, secret: string | undefined): string {
  const withoutValue = secret ? text.split(secret).join("[key]") : text;
  return withoutValue.replace(/api_key:[^\s'"]+/gi, "api_key:[redacted]");
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
