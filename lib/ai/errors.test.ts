import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { checkApiKeyFormat, maskApiKey } from "../api-key.ts";
import { classifyApiError } from "./errors.ts";

const browser = { source: "browser", value: "sk-ant-api03-test" } as const;
const server = { source: "server" } as const;
const counts = { attempts: 6, retries429: 5 };
const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers());

describe("classifyApiError", () => {
  test("401 is an invalid key, worded for whichever key was used", () => {
    const pasted = classifyApiError(apiError(401, "authentication_error", "invalid x-api-key"), browser, counts)!;
    assert.equal(pasted.kind, "invalid_key");
    assert.match(pasted.message, /the API key you pasted/);
    const env = classifyApiError(apiError(401, "authentication_error", "invalid x-api-key"), server, counts)!;
    assert.match(env.message, /ANTHROPIC_API_KEY from \.env\.local/);
  });

  test("a low credit balance is out of credits, not a generic 400", () => {
    const result = classifyApiError(
      apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
      browser,
      counts,
    )!;
    assert.equal(result.kind, "no_credits");
    assert.match(result.message, /out of credits/);
  });

  test("billing_error is out of credits", () => {
    assert.equal(classifyApiError(apiError(402, "billing_error", "Payment required"), server, counts)!.kind, "no_credits");
  });

  test("429 is rate limited and reports the retries", () => {
    const result = classifyApiError(apiError(429, "rate_limit_error", "Too many requests"), browser, counts)!;
    assert.equal(result.kind, "rate_limited");
    assert.match(result.message, /5 automatic retries/);
  });

  test("529 is overloaded and other 400s are API errors", () => {
    assert.equal(classifyApiError(apiError(529, "overloaded_error", "Overloaded"), server, counts)!.kind, "overloaded");
    assert.equal(classifyApiError(apiError(400, "invalid_request_error", "max_tokens too large"), server, counts)!.kind, "api");
  });

  test("non-SDK errors are left alone", () => assert.equal(classifyApiError(new Error("boom"), server, counts), null));

  test("messages never contain the key", () => {
    const result = classifyApiError(apiError(401, "authentication_error", "invalid x-api-key"), browser, counts)!;
    assert.ok(!result.message.includes(browser.value));
  });
});

describe("API key format and masking", () => {
  const key = `sk-ant-api03-${"a".repeat(80)}WXYZ`;
  test("accepts a well-formed key and trims whitespace", () => assert.deepEqual(checkApiKeyFormat(`  ${key}\n`), { ok: true, key }));
  test("rejects a non-Anthropic key", () => assert.match((checkApiKeyFormat("sk-proj-123") as { message: string }).message, /start with sk-ant-/));
  test("rejects a truncated key", () => assert.match((checkApiKeyFormat("sk-ant-api03-abc") as { message: string }).message, /cut off/));
  test("masks all but the last 4 characters", () => assert.equal(maskApiKey(key), "sk-ant-…WXYZ"));
});
