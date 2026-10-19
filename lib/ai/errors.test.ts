import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { maskApiKey, normalizeApiKey } from "../api-key.ts";
import { classifyApiError } from "./errors.ts";

const browser = { source: "browser", value: "AQ.Ab8RN6test-pasted-key-0123456789" } as const;
const server = { source: "server" } as const;
const counts = { attempts: 6, retries429: 5 };

const NAMES: Record<number, string> = { 400: "BadRequestError", 401: "AuthenticationError", 403: "PermissionDeniedError", 404: "NotFoundError", 429: "RateLimitError" };

/** The shape the Gemini SDK throws for an HTTP error: status, headers, and the API's google.rpc.Status body. */
function apiError(status: number, rpcStatus: string, message: string, details: unknown[] = [], headers = new Headers()) {
  return Object.assign(new Error(`${status} ${message}`), {
    name: NAMES[status] ?? (status >= 500 ? "InternalServerError" : "APIError"),
    status,
    statusCode: status,
    headers,
    error: { httpMeta: { response: {}, request: {} }, error: { code: status, message, status: rpcStatus, details } },
  });
}
const quotaFailure = (quotaId: string) => ({
  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
  violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId }],
});
const retryInfo = (retryDelay: string) => ({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay });
const QUOTA_MESSAGE = "You exceeded your current quota, please check your plan and billing details.";

describe("classifyApiError", () => {
  test("API_KEY_INVALID is an invalid key, worded for whichever key was used", () => {
    const invalid = () =>
      apiError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" },
      ]);
    const pasted = classifyApiError(invalid(), browser, counts)!;
    assert.equal(pasted.kind, "invalid_key");
    assert.match(pasted.message, /the API key you pasted/);
    assert.match(classifyApiError(invalid(), server, counts)!.message, /GEMINI_API_KEY from \.env\.local/);
  });

  test("a plain 401 from Google is an invalid key and quotes Google's reason", () => {
    const result = classifyApiError(apiError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."), browser, counts)!;
    assert.equal(result.kind, "invalid_key");
    assert.match(result.message, /Google rejected the API key you pasted/);
    assert.match(result.message, /Google said: Request had invalid authentication credentials\./);
  });

  test("an ephemeral Live-API token, refused by the SDK before sending, is an invalid key", () => {
    const result = classifyApiError(new Error("Ephemeral tokens are only supported by the live API."), browser, counts)!;
    assert.equal(result.kind, "invalid_key");
    assert.match(result.message, /^The API key you pasted is an ephemeral token/);
  });

  test("a leaked key and a 403 are key problems too", () => {
    const leaked = classifyApiError(apiError(403, "PERMISSION_DENIED", "Your API key was reported as leaked. Please use another API key."), browser, counts)!;
    assert.equal(leaked.kind, "invalid_key");
    assert.match(leaked.message, /leaked/);
    assert.equal(classifyApiError(apiError(403, "PERMISSION_DENIED", "Permission denied."), server, counts)!.kind, "invalid_key");
  });

  test("a per-minute 429 is rate limited, honours RetryInfo and reports the retries", () => {
    const result = classifyApiError(
      apiError(429, "RESOURCE_EXHAUSTED", QUOTA_MESSAGE, [quotaFailure("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"), retryInfo("37.5s")]),
      browser,
      counts,
    )!;
    assert.equal(result.kind, "rate_limited");
    assert.equal(result.retryAfterMs, 37_500);
    assert.match(result.message, /5 automatic retries/);
  });

  test("a 429 without details is rate limited and falls back to Retry-After", () => {
    const result = classifyApiError(apiError(429, "RESOURCE_EXHAUSTED", "Resource exhausted.", [], new Headers({ "retry-after": "12" })), server, counts)!;
    assert.equal(result.kind, "rate_limited");
    assert.equal(result.retryAfterMs, 12_000);
  });

  test("a per-day 429 is quota exceeded, not a rate limit to retry", () => {
    const result = classifyApiError(
      apiError(429, "RESOURCE_EXHAUSTED", QUOTA_MESSAGE, [quotaFailure("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), retryInfo("20s")]),
      browser,
      counts,
    )!;
    assert.equal(result.kind, "quota_exceeded");
    assert.match(result.message, /midnight Pacific time/);
    assert.equal(result.retryAfterMs, undefined);
  });

  test("limit: 0 (no free quota for the model) and a missing free tier are quota exceeded", () => {
    const zero = classifyApiError(
      apiError(429, "RESOURCE_EXHAUSTED", `${QUOTA_MESSAGE}\n* Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-4-argon`, [
        quotaFailure("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
      ]),
      server,
      counts,
    )!;
    assert.equal(zero.kind, "quota_exceeded");
    assert.match(zero.message, /may not be on the free tier/);
    const region = classifyApiError(
      apiError(400, "FAILED_PRECONDITION", "Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio."),
      browser,
      counts,
    )!;
    assert.equal(region.kind, "quota_exceeded");
  });

  test("503 is overloaded, other 5xx unavailable, 404 names the model config, other 400s are API errors", () => {
    assert.equal(classifyApiError(apiError(503, "UNAVAILABLE", "The model is overloaded."), server, counts)!.kind, "overloaded");
    assert.equal(classifyApiError(apiError(500, "INTERNAL", "Internal error."), server, counts)!.kind, "unavailable");
    assert.match(classifyApiError(apiError(404, "NOT_FOUND", "models/gemini-9 is not found."), server, counts)!.message, /lib\/ai\/config\.ts/);
    assert.equal(classifyApiError(apiError(400, "INVALID_ARGUMENT", "Request contains an invalid argument."), server, counts)!.kind, "api");
  });

  test("timeouts and connection failures are unavailable", () => {
    const timeout = Object.assign(new Error("Request timed out"), { name: "APIConnectionTimeoutError" });
    const offline = Object.assign(new Error("fetch failed"), { name: "APIConnectionError" });
    assert.equal(classifyApiError(timeout, server, counts)!.kind, "unavailable");
    assert.equal(classifyApiError(offline, server, counts)!.kind, "unavailable");
  });

  test("non-SDK errors are left alone", () => assert.equal(classifyApiError(new Error("boom"), server, counts), null));

  test("messages never contain the key, even when Google's own message quotes it", () => {
    const invalid = classifyApiError(apiError(400, "INVALID_ARGUMENT", "API key not valid.", [{ reason: "API_KEY_INVALID" }]), browser, counts)!;
    assert.ok(!invalid.message.includes(browser.value));
    const suspended = classifyApiError(
      apiError(403, "PERMISSION_DENIED", `Permission denied: Consumer 'api_key:${browser.value}' has been suspended.`),
      browser,
      counts,
    )!;
    assert.ok(!suspended.message.includes(browser.value), suspended.message);
    assert.match(suspended.message, /api_key:\[redacted\]/);
    const serverKey = classifyApiError(apiError(403, "PERMISSION_DENIED", "Consumer 'api_key:AQ.Ab8serverkey123' has been suspended."), server, counts)!;
    assert.ok(!serverKey.message.includes("AQ.Ab8serverkey123"), serverKey.message);
  });
});

describe("API key handling: no format checks, Google decides", () => {
  test("accepts an AI Studio auth key and trims whitespace", () => {
    const key = "AQ.Ab8RN6exampleAuthKeyWXYZ";
    assert.deepEqual(normalizeApiKey(`  ${key}\n`), { ok: true, key });
  });
  test("accepts any other non-empty string, whatever its prefix or length", () => {
    for (const key of ["AIzaSyLegacyStyleKey0123456789abcdefghi", "sk-ant-api03-not-a-gemini-key", "abc"]) {
      assert.deepEqual(normalizeApiKey(key), { ok: true, key });
    }
  });
  test("refuses only an empty paste", () => {
    for (const blank of ["", "   ", "\n\t"]) assert.equal(normalizeApiKey(blank).ok, false);
  });
  test("masks all but the last 4 characters, with no assumed prefix", () => {
    assert.equal(maskApiKey("AQ.Ab8RN6exampleAuthKeyWXYZ"), "…WXYZ");
    assert.equal(maskApiKey("short"), "…");
  });
});
