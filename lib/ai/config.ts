// Model settings for every call MockBuddy makes, in one place so they can be tuned
// against measured quality, timings and cost.

/**
 * Which model each kind of call uses. This is the one place to change model choice;
 * prices for estimating cost are in pricing.ts.
 */
export const MODELS = {
  topicLabels: "claude-haiku-5-5",
  blueprint: "claude-opus-5-5",
  draft: "claude-sonnet-5-5",
  critique: "claude-sonnet-5-5",
  revise: "claude-sonnet-5-5",
  grading: "claude-sonnet-5-5",
} as const;

export type ModelTask = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelTask];
export type Effort = "low" | "medium" | "high";

/** Reasoning effort per call. Set explicitly: the defaults differ by model. */
export const EFFORT: Record<ModelTask, Effort> = {
  topicLabels: "low",
  blueprint: "medium",
  draft: "medium",
  critique: "medium",
  revise: "medium",
  grading: "medium",
};

/** Output cap per call. Thinking counts toward it, so leave room above the JSON itself. */
export const MAX_TOKENS: Record<ModelTask, number> = {
  topicLabels: 8_000,
  blueprint: 24_000,
  draft: 32_000,
  critique: 16_000,
  revise: 24_000,
  grading: 8_000,
};

/** Vercel's function limit. Locally nothing enforces it, so requests only warn past it. */
export const SERVERLESS_LIMIT_MS = 60_000;

/** When a request must have finished, or undefined locally where no limit applies. */
export function requestDeadline(startedAt: number): number | undefined {
  return process.env.VERCEL === "1" ? startedAt + 55_000 : undefined;
}

/** Logs a warning when a request ran longer than it would be allowed to on Vercel. */
export function warnIfOverServerlessLimit(route: string, startedAt: number, context: Record<string, unknown> = {}) {
  const durationMs = Date.now() - startedAt;
  if (durationMs > SERVERLESS_LIMIT_MS) {
    console.warn(JSON.stringify({ event: "over_serverless_limit", route, durationMs, ...context }));
  }
}
