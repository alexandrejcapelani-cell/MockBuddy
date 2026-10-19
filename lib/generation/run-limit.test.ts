import assert from "node:assert/strict";
import { test } from "node:test";
import { GENERATION_RUN_LIMIT_MS } from "../ai/config.ts";
import { RunTimedOutError, runDeadline, runMsLeft } from "./run-limit.ts";

const created = new Date("2026-10-19T10:00:00Z");

test("a run gets the limit from its start, or from creation for older rows", () => {
  assert.equal(GENERATION_RUN_LIMIT_MS, 180_000);
  assert.equal(runDeadline({ runStartedAt: null, createdAt: created }), created.getTime() + 180_000);
  const retried = new Date("2026-10-19T10:30:00Z");
  assert.equal(runDeadline({ runStartedAt: retried, createdAt: created }), retried.getTime() + 180_000);
});

test("time left counts down to zero and never goes negative", () => {
  const exam = { runStartedAt: created, createdAt: created };
  assert.equal(runMsLeft(exam, created.getTime() + 60_000), 120_000);
  assert.equal(runMsLeft(exam, created.getTime() + 10 * 60_000), 0);
});

test("the timeout message names the limit and the last problem", () => {
  assert.match(new RunTimedOutError().message, /3-minute limit/);
  assert.match(new RunTimedOutError("The AI service is busy.").message, /The last thing that happened: The AI service is busy\./);
});
