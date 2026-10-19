// Model settings for every call MockBuddy makes, in one place so they can be tuned
// against measured quality, timings and cost.

/**
 * Which Gemini model each kind of call uses. This is the one place to change model choice;
 * prices for estimating cost are in pricing.ts. Both models are stable and have a free
 * tier; Gemini 4 Argon and 3.1 Pro don't, so they would fail on a free key.
 */
export const MODELS = {
  topicLabels: "gemini-3.5-flash-lite",
  blueprint: "gemini-3.8-flash",
  draft: "gemini-3.8-flash",
  critique: "gemini-3.8-flash",
  revise: "gemini-3.8-flash",
  grading: "gemini-3.8-flash",
} as const;

export type ModelTask = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelTask];

/** Gemini's thinking levels. gemini-3.8-flash rejects "minimal". */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Thinking level per call. Set explicitly: the defaults differ by model. The blueprint runs
 * once per sample exam and shapes every mock after it, so it gets the most thinking.
 */
export const THINKING: Record<ModelTask, ThinkingLevel> = {
  topicLabels: "low",
  blueprint: "high",
  draft: "medium",
  critique: "medium",
  revise: "medium",
  grading: "medium",
};

/** Output cap per call. Thinking counts toward it, so leave room above the JSON itself. */
export const MAX_TOKENS: Record<ModelTask, number> = {
  topicLabels: 8_000,
  blueprint: 32_000,
  draft: 32_000,
  critique: 16_000,
  revise: 24_000,
  grading: 8_000,
};

/**
 * How the browser runs an exam's batches. "sequential" runs one batch at a time, which keeps
 * a free-tier key under its requests-per-minute limit; "parallel" runs up to PARALLEL_BATCHES
 * at once, for keys with paid-tier limits. Each batch is still draft, critique, revise.
 */
export const BATCH_MODE: "sequential" | "parallel" = "sequential";
export const PARALLEL_BATCHES = 4;

/** Batches generating at once under BATCH_MODE. */
export function batchConcurrency(): number {
  return BATCH_MODE === "parallel" ? PARALLEL_BATCHES : 1;
}

/**
 * Vercel's function limit on the Hobby plan with Fluid compute (on by default): 300 s.
 * Every AI route exports `maxDuration = 300` (as a literal: Next.js reads it statically).
 * Locally nothing enforces it, so requests only warn past it.
 */
export const REQUEST_LIMIT_SECONDS = 300;
export const SERVERLESS_LIMIT_MS = REQUEST_LIMIT_SECONDS * 1_000;

/** When a request must have finished (10 s inside the limit, on Vercel), or undefined locally. */
export function requestDeadline(startedAt: number): number | undefined {
  return process.env.VERCEL === "1" ? startedAt + SERVERLESS_LIMIT_MS - 10_000 : undefined;
}

/** Logs a warning when a request ran longer than it would be allowed to on Vercel. */
export function warnIfOverServerlessLimit(route: string, startedAt: number, context: Record<string, unknown> = {}) {
  const durationMs = Date.now() - startedAt;
  if (durationMs > SERVERLESS_LIMIT_MS) {
    console.warn(JSON.stringify({ event: "over_serverless_limit", route, durationMs, ...context }));
  }
}
