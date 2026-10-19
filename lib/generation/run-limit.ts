import { GENERATION_RUN_LIMIT_MS } from "../ai/config.ts";

// The hard ceiling on a generation run (GENERATION_RUN_LIMIT_MS, 3 minutes). A run starts
// when the mock is created or when the student presses Retry; see exams.run_started_at.

export const RUN_LIMIT_MINUTES = GENERATION_RUN_LIMIT_MS / 60_000;

/** Epoch ms when the exam's current run must stop. Rows from before the limit count from created_at. */
export function runDeadline(exam: { runStartedAt: Date | null; createdAt: Date }): number {
  return (exam.runStartedAt ?? exam.createdAt).getTime() + GENERATION_RUN_LIMIT_MS;
}

export function runMsLeft(exam: { runStartedAt: Date | null; createdAt: Date }, now = Date.now()): number {
  return Math.max(0, runDeadline(exam) - now);
}

/** The run reached its ceiling. Batches that finished keep their questions. */
export class RunTimedOutError extends Error {
  override name = "RunTimedOutError";
  constructor(lastProblem?: string) {
    super(
      `This mock hit the ${RUN_LIMIT_MINUTES}-minute limit before it finished.` +
        (lastProblem ? ` The last thing that happened: ${lastProblem}` : ""),
    );
  }
}
