import Anthropic from "@anthropic-ai/sdk";
import type { ApiKey } from "../api-key.ts";

// Turns Anthropic SDK errors into failure kinds with messages the student can act on.
// Missing key, invalid key, out of credits and rate limited each get their own kind and
// wording, so the UI can tell them apart. Messages never include the key itself.

export type ModelFailureKind =
  | "missing_key"
  | "invalid_key"
  | "no_credits"
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

/** The key has to be fixed before anything can work; retrying won't help. */
export const KEY_PROBLEM_KINDS: ReadonlySet<ModelFailureKind> = new Set(["missing_key", "invalid_key", "no_credits"]);

export interface ClassifiedError {
  kind: ModelFailureKind;
  message: string;
  retryAfterMs?: number;
}

export const MISSING_KEY_MESSAGE =
  "No Anthropic API key. Paste your own key in the API key field on the home page, or set ANTHROPIC_API_KEY in .env.local.";

export function whoseKey(key: ApiKey): string {
  return key.source === "browser" ? "the API key you pasted" : "ANTHROPIC_API_KEY from .env.local";
}

/** Null when `error` is not an error from the Anthropic SDK. */
export function classifyApiError(error: unknown, key: ApiKey, context: { attempts: number; retries429: number }): ClassifiedError | null {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { kind: "unavailable", message: "The model call timed out." };
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: "unavailable", message: `Couldn't reach the Anthropic API: ${error.message}` };
  }
  if (!(error instanceof Anthropic.APIError)) return null;

  const detail = apiMessage(error);
  if (error.type === "billing_error" || error.status === 402 || /credit balance|spend limit|usage limits?/i.test(detail)) {
    return {
      kind: "no_credits",
      message: `The Anthropic account behind ${whoseKey(key)} is out of credits or has reached its spend limit. Add credits or raise the limit in the Anthropic Console (Plans & Billing), then try again. Anthropic said: ${detail}`,
    };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return {
      kind: "invalid_key",
      message:
        key.source === "browser"
          ? "Anthropic rejected the API key you pasted (HTTP 401): it's wrong or has been revoked. Clear it on the home page and paste a valid key."
          : "Anthropic rejected ANTHROPIC_API_KEY from .env.local (HTTP 401): it's wrong or has been revoked. Fix it in .env.local, or paste a valid key on the home page.",
    };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return {
      kind: "invalid_key",
      message: `Anthropic refused ${whoseKey(key)} for this request (HTTP 403): ${detail}. The key may not have access to this model or workspace.`,
    };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return {
      kind: "rate_limited",
      message: `Rate limited by Anthropic (HTTP 429): still limited after ${context.attempts} attempt(s) and ${context.retries429} automatic retries. Wait a minute and try again; if it keeps happening, the account's rate-limit tier is too low for several batches at once.`,
      retryAfterMs: retryAfterMs(error.headers),
    };
  }
  if (error.status === 529 || error.type === "overloaded_error") {
    return { kind: "overloaded", message: "The Anthropic API is overloaded (HTTP 529).", retryAfterMs: retryAfterMs(error.headers) };
  }
  if (error.status !== undefined && error.status >= 500) {
    return { kind: "unavailable", message: `The Anthropic API failed (HTTP ${error.status}).`, retryAfterMs: retryAfterMs(error.headers) };
  }
  return { kind: "api", message: `The Anthropic API rejected the request (HTTP ${error.status ?? "?"}): ${detail}` };
}

/** The API's own error message, without the SDK's "400 {json}" prefix. */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === "string" ? body.error.message : error.message;
}

export function retryAfterMs(headers: Headers | undefined): number | undefined {
  const ms = Number(headers?.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const seconds = Number(headers?.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}
