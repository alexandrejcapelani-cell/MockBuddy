import assert from "node:assert/strict";
import { test } from "node:test";
import { MODELS } from "./config.ts";
import { estimateCostUsd, formatUsd, summarizeCalls } from "./pricing.ts";

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
});
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("every model in the map has a price", () => {
  for (const model of Object.values(MODELS)) assert.notEqual(estimateCostUsd(model, usage(1, 1)), null, model);
});

test("Sonnet 5.5: $2 in / $10 out per million, cache reads at 0.1x and writes at 1.25x", () => {
  close(estimateCostUsd("claude-sonnet-5-5", usage(1_000_000, 100_000)), 3);
  close(estimateCostUsd("claude-sonnet-5-5", usage(0, 0, 1_000_000, 1_000_000)), 0.2 + 2.5);
});

test("Opus 5.5: $4 / $20, cache reads at 0.05x", () => {
  close(estimateCostUsd("claude-opus-5-5", usage(10_000, 3_000)), 0.04 + 0.06);
  close(estimateCostUsd("claude-opus-5-5", usage(0, 0, 1_000_000)), 0.2);
});

test("Haiku 5.5 switches to its long-prompt rate card above 100K prompt tokens", () => {
  close(estimateCostUsd("claude-haiku-5-5", usage(20_000, 1_000)), 0.002 + 0.0005);
  close(estimateCostUsd("claude-haiku-5-5", usage(120_000, 1_000)), 0.06 + 0.0025);
});

test("unknown models have no estimate, and small amounts keep their precision", () => {
  assert.equal(estimateCostUsd("claude-unknown", usage(1, 1)), null);
  assert.equal(formatUsd(0.0025), "$0.0025");
  assert.equal(formatUsd(1.234), "$1.23");
});

test("summarizeCalls groups by the model that answered", () => {
  const summary = summarizeCalls([
    { model: "claude-haiku-5-5", servedBy: "claude-haiku-5-5", durationMs: 1200, estimatedCostUsd: 0.001 },
    { model: "claude-haiku-5-5", servedBy: "claude-haiku-5-5", durationMs: 1900, estimatedCostUsd: 0.0011 },
    { model: "claude-opus-5-5", servedBy: null, durationMs: 21_000, estimatedCostUsd: null },
  ]);
  assert.equal(summary, "claude-haiku-5-5: 2 calls, 3.1 s, ≈$0.0021; claude-opus-5-5: 1 call, 21.0 s, ≈$0");
});
