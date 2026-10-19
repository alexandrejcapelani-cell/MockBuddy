// Model settings for every call MockBuddy makes, in one place so they can be tuned
// against measured quality and timings.

export const MODEL = "claude-sonnet-5-5";

/** Reasoning effort per call. Sonnet 5.5 defaults to "high" when unset. */
export const EFFORT = {
  topicLabels: "low",
  blueprint: "medium",
  draft: "medium",
  critique: "medium",
  revise: "medium",
} as const;

export const MAX_TOKENS = {
  topicLabels: 8_000,
  blueprint: 24_000,
  draft: 32_000,
  critique: 16_000,
  revise: 24_000,
} as const;

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
