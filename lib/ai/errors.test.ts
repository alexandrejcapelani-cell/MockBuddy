import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classifyApiError, MISSING_KEY_MESSAGE } from "./errors.ts";

const SECRET = "AQ.Ab8RN6test-server-key-0123456789";
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
const classify = (error: unknown) => classifyApiError(error, counts, SECRET)!;
const quotaFailure = (quotaId: string) => ({
  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
  violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId }],
});
const retryInfo = (retryDelay: string) => ({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay });
const QUOTA_MESSAGE = "You exceeded your current quota, please check your plan and billing details.";

describe("classifyApiError", () => {
  test("a rejected server key is an invalid key, and the student is told it's not theirs to fix", () => {
    for (const error of [
      apiError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [{ reason: "API_KEY_INVALID" }]),
      apiError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."),
      apiError(403, "PERMISSION_DENIED", "Permission denied."),
      apiError(403, "PERMISSION_DENIED", "Your API key was reported as leaked. Please use another API key."),
    ]) {
      const result = classify(error);
      assert.equal(result.kind, "invalid_key", error.message);
      assert.match(result.message, /on our side, not yours/);
      assert.equal(result.httpStatus, error.status);
    }
  });

  test("Google's reason goes to the log, and neither it nor the HTTP code is in the student's message", () => {
    const result = classify(apiError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."));
    assert.equal(result.detail, "Request had invalid authentication credentials.");
    assert.doesNotMatch(result.message, /Google said|authentication credentials|HTTP|401/);
  });

  test("no student-facing message carries text meant for the site owner", () => {
    const messages = [
      MISSING_KEY_MESSAGE,
      classify(new Error("Ephemeral tokens are only supported by the live API.")).message,
      classify(apiError(403, "PERMISSION_DENIED", "Your API key was reported as leaked. Please use another API key.")).message,
      classify(apiError(403, "PERMISSION_DENIED", "Method doesn't allow unregistered callers.")).message,
      classify(apiError(429, "RESOURCE_EXHAUSTED", QUOTA_MESSAGE, [quotaFailure("GenerateRequestsPerDayPerProjectPerModel-FreeTier")])).message,
      classify(apiError(400, "FAILED_PRECONDITION", "Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.")).message,
      classify(apiError(404, "NOT_FOUND", "models/gemini-9 is not found.")).message,
      classify(apiError(400, "INVALID_ARGUMENT", "Request contains an invalid argument.")).message,
    ];
    for (const message of messages) assert.doesNotMatch(message, /Google said|Site owner|GEMINI_API_KEY|lib\/|MODELS|HTTP|\b[45]\d\d\b/, message);
  });

  test("an ephemeral Live-API token, refused by the SDK before sending, is an invalid key", () => {
    assert.equal(classify(new Error("Ephemeral tokens are only supported by the live API.")).kind, "invalid_key");
  });

  test("a per-minute 429 is rate limited, honours RetryInfo and reports the retries", () => {
    const result = classify(
      apiError(429, "RESOURCE_EXHAUSTED", QUOTA_MESSAGE, [quotaFailure("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"), retryInfo("37.5s")]),
    );
    assert.equal(result.kind, "rate_limited");
    assert.equal(result.retryAfterMs, 37_500);
    assert.match(result.message, /5 automatic retries/);
  });

  test("a 429 without details is rate limited and falls back to Retry-After", () => {
    const result = classify(apiError(429, "RESOURCE_EXHAUSTED", "Resource exhausted.", [], new Headers({ "retry-after": "12" })));
    assert.equal(result.kind, "rate_limited");
    assert.equal(result.retryAfterMs, 12_000);
  });

  test("a per-day 429 is quota exceeded, says when it resets, and isn't retried", () => {
    const result = classify(
      apiError(429, "RESOURCE_EXHAUSTED", QUOTA_MESSAGE, [quotaFailure("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), retryInfo("20s")]),
    );
    assert.equal(result.kind, "quota_exceeded");
    assert.match(result.message, /midnight Pacific time/);
    assert.equal(result.retryAfterMs, undefined);
  });

  test("limit: 0 (no free quota for the model) and a missing free tier are quota exceeded", () => {
    const zero = classify(
      apiError(429, "RESOURCE_EXHAUSTED", `${QUOTA_MESSAGE}\n* Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-4-argon`, [
        quotaFailure("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
      ]),
    );
    assert.equal(zero.kind, "quota_exceeded");
    const region = classify(
      apiError(400, "FAILED_PRECONDITION", "Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio."),
    );
    assert.equal(region.kind, "quota_exceeded");
  });

  test("503 is overloaded, other 5xx unavailable, 404 names the model config, other 400s are API errors", () => {
    assert.equal(classify(apiError(503, "UNAVAILABLE", "The model is overloaded.")).kind, "overloaded");
    assert.equal(classify(apiError(500, "INTERNAL", "Internal error.")).kind, "unavailable");
    assert.match(classify(apiError(404, "NOT_FOUND", "models/gemini-9 is not found.")).detail ?? "", /lib\/ai\/config\.ts/);
    assert.equal(classify(apiError(400, "INVALID_ARGUMENT", "Request contains an invalid argument.")).kind, "api");
    assert.doesNotMatch(classify(apiError(503, "UNAVAILABLE", "The model is overloaded.")).message, /503|HTTP/);
  });

  test("timeouts and connection failures are unavailable", () => {
    assert.equal(classify(Object.assign(new Error("Request timed out"), { name: "APIConnectionTimeoutError" })).kind, "unavailable");
    assert.equal(classify(Object.assign(new Error("fetch failed"), { name: "APIConnectionError" })).kind, "unavailable");
  });

  test("non-SDK errors are left alone", () => assert.equal(classifyApiError(new Error("boom"), counts, SECRET), null));

  test("messages never contain the key, even when Google's own message quotes it", () => {
    const quoted = classify(apiError(403, "PERMISSION_DENIED", `Permission denied: Consumer 'api_key:${SECRET}' has been suspended.`));
    assert.ok(!quoted.message.includes(SECRET), quoted.message);
    assert.ok(!quoted.detail?.includes(SECRET), quoted.detail);
    const bare = classify(apiError(400, "INVALID_ARGUMENT", `The key ${SECRET} is invalid.`, [{ reason: "API_KEY_INVALID" }]));
    assert.ok(!bare.message.includes(SECRET), bare.message);
    assert.ok(!bare.detail?.includes(SECRET), bare.detail);
    const unknown = classifyApiError(apiError(403, "PERMISSION_DENIED", "Consumer 'api_key:AQ.Ab8otherkey123' has been suspended."), counts)!;
    assert.ok(!unknown.message.includes("AQ.Ab8otherkey123"), unknown.message);
  });
});
