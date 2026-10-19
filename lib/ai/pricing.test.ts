import assert from "node:assert/strict";
import { test } from "node:test";
import { MODELS } from "./config.ts";
import { estimateCostUsd, formatCost, formatUsd, summarizeCalls } from "./pricing.ts";

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, thoughtTokens = 0) => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  thoughtTokens,
});
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const OCT_2026 = new Date("2026-10-19T12:00:00Z");

test("every model in the map has a paid price", () => {
  for (const model of Object.values(MODELS)) assert.notEqual(estimateCostUsd(model, usage(1, 1), "paid"), null, model);
});

test("the free tier costs exactly nothing, for any model", () => {
  for (const model of [...Object.values(MODELS), "gemini-unknown"]) assert.equal(estimateCostUsd(model, usage(1_000_000, 1_000_000), "free"), 0);
});

test("gemini-3.8-flash in 2026: $0.75 in / $3.75 out per million, cached input $0.075, thinking billed as output", () => {
  close(estimateCostUsd("gemini-3.8-flash", usage(1_000_000, 100_000), "paid", OCT_2026), 0.75 + 0.375);
  close(estimateCostUsd("gemini-3.8-flash", usage(0, 0, 1_000_000), "paid", OCT_2026), 0.075);
  close(estimateCostUsd("gemini-3.8-flash", usage(0, 100_000, 0, 100_000), "paid", OCT_2026), 0.75);
});

test("gemini-3.8-flash prices double from 1 January 2027", () => {
  close(estimateCostUsd("gemini-3.8-flash", usage(1_000_000, 100_000), "paid", new Date("2027-01-01T00:00:00Z")), 1.5 + 0.75);
  close(estimateCostUsd("gemini-3.8-flash", usage(1_000_000, 0), "paid", new Date("2026-12-31T23:59:59Z")), 0.75);
});

test("gemini-3.5-flash-lite: $0.30 in / $2.50 out", () => {
  close(estimateCostUsd("gemini-3.5-flash-lite", usage(20_000, 1_000, 0, 500), "paid", OCT_2026), 0.006 + 0.00375);
});

test("unknown models have no paid estimate, and small amounts keep their precision", () => {
  assert.equal(estimateCostUsd("gemini-unknown", usage(1, 1), "paid"), null);
  assert.equal(formatUsd(0.0025), "$0.0025");
  assert.equal(formatUsd(1.234), "$1.23");
});

test("formatCost says free tier rather than $0 when every call was free", () => {
  assert.equal(formatCost([{ billingTier: "free", estimatedCostUsd: 0 }]), "free tier");
  assert.equal(formatCost([{ billingTier: "paid", estimatedCostUsd: 0.001 }, { billingTier: "free", estimatedCostUsd: 0 }]), "≈$0.0010");
});

test("summarizeCalls groups by the model that answered", () => {
  const summary = summarizeCalls([
    { model: "gemini-3.5-flash-lite", servedBy: "gemini-3.5-flash-lite", durationMs: 1200, billingTier: "free", estimatedCostUsd: 0 },
    { model: "gemini-3.5-flash-lite", servedBy: "gemini-3.5-flash-lite", durationMs: 1900, billingTier: "free", estimatedCostUsd: 0 },
    { model: "gemini-3.8-flash", servedBy: null, durationMs: 21_000, billingTier: "paid", estimatedCostUsd: 0.0021 },
  ]);
  assert.equal(summary, "gemini-3.5-flash-lite: 2 calls, 3.1 s, free tier; gemini-3.8-flash: 1 call, 21.0 s, ≈$0.0021");
});
