// Browser-side driver for generation: runs the exam's batches (one at a time by default, or
// in parallel: BATCH_MODE in lib/ai/config.ts), each through its stages one request at a
// time, then tops up dropped questions and finalizes.
// Every step is resumable: reloading the page starts again from what the database says.
//
// A run never goes past its ceiling (GENERATION_RUN_LIMIT_MS): the server gives every stage
// that deadline and refuses stages after it, and this runner stops at the same moment,
// with a timeout on every request, so a stuck call can't hold it either.

import { batchConcurrency } from "../ai/config.ts";
import { postJson } from "../upload-client.ts";
import type { BatchView, ExamProgress } from "./context.ts";
import { RunTimedOutError } from "./run-limit.ts";

const MAX_TRANSIENT_RETRIES = 4;
const MAX_STAGE_STEPS = 10;
const BUSY_POLL_MS = 2_000;
const MAX_TOPUP_ROUNDS = 3;
/** On top of the run's time left, for the server to save and answer after its deadline. */
const RESPONSE_GRACE_MS = 15_000;

export interface RunnerEvents {
  onBatch(batch: BatchView): void;
  onPhase(phase: "batches" | "topup" | "finalizing"): void;
}

export interface GenerationResult {
  requested: number;
  generated: number;
  short: number;
}

/** The run reached its time limit; the screen offers Retry and keeping the ready questions. */
export class GenerationTimedOut extends Error {
  override name = "GenerationTimedOut";
}

/** When this run must stop, on the browser's clock. */
interface Clock {
  deadline: number;
  /** The last failure seen, to say why the time ran out. */
  lastProblem?: string;
}

const msLeft = (clock: Clock) => clock.deadline - Date.now();
const timedOut = (clock: Clock) => new GenerationTimedOut(new RunTimedOutError(clock.lastProblem).message);

/** `progress` is the latest state if the caller has it (e.g. from Retry); otherwise it's fetched. */
export async function runGeneration(examId: string, events: RunnerEvents, progress?: ExamProgress): Promise<GenerationResult> {
  const start = progress ?? (await fetchProgress(examId));
  // The server measured the time left, so the two clocks don't need to agree.
  const clock: Clock = { deadline: Date.now() + start.runMsLeft };
  if (start.status === "generating" && msLeft(clock) <= 0) throw timedOut(clock);

  events.onPhase("batches");
  await runPendingBatches(examId, start, events, clock);

  for (let round = 0; round < MAX_TOPUP_ROUNDS; round++) {
    if (msLeft(clock) <= 0) throw timedOut(clock);
    const topup = await postJson<{ status: string; batchIndex?: number }>(`/api/exams/${examId}/topup`, {}, { timeoutMs: msLeft(clock) + RESPONSE_GRACE_MS });
    if (!topup.ok) {
      if (topup.data.kind === "run_timed_out") throw new GenerationTimedOut(topup.error);
      throw new Error(`Couldn't top up dropped questions: ${topup.error}`);
    }
    if (topup.data.status === "created") {
      events.onPhase("topup");
      await runBatch(examId, topup.data.batchIndex!, events, clock);
    } else if (topup.data.status === "pending") {
      // Another tab is still running a batch; help finish it.
      await runPendingBatches(examId, await fetchProgress(examId), events, clock);
    } else {
      break;
    }
  }

  // Bookkeeping only (no model call), so it runs even if the last batch finished at the wire.
  events.onPhase("finalizing");
  const result = await postJson<GenerationResult>(`/api/exams/${examId}/finalize`, {}, { timeoutMs: 30_000 });
  if (!result.ok) throw new Error(`Couldn't finish the exam: ${result.error}`);
  return result.data;
}

export async function fetchProgress(examId: string): Promise<ExamProgress> {
  let response: Response;
  try {
    response = await fetch(`/api/exams/${examId}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`Couldn't reach the app server: ${(error as Error).message}`);
  }
  const body = (await response.json()) as ExamProgress & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}

async function runPendingBatches(examId: string, progress: ExamProgress, events: RunnerEvents, clock: Clock) {
  progress.batches.forEach((batch) => events.onBatch(batch));
  const pending = progress.batches.filter((batch) => batch.stage !== "done" && batch.stage !== "failed");
  const results = await withConcurrency(pending, batchConcurrency(), (batch) => runBatch(examId, batch.batchIndex, events, clock));
  const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason as Error] : []));
  // A timeout is what the screen needs to know about, whatever else went wrong alongside it.
  const timeout = failures.find((failure) => failure instanceof GenerationTimedOut);
  if (timeout) throw timeout;
  // Batches usually fail for the same reason (a bad key, a rate limit), so say each reason once.
  if (failures.length > 0) throw new Error([...new Set(failures.map((failure) => failure.message))].join(" "));
}

/** Calls /api/generate until the batch is done or failed, or the run's time is up. */
async function runBatch(examId: string, batchIndex: number, events: RunnerEvents, clock: Clock): Promise<BatchView> {
  let steps = 0;
  let transient = 0;
  while (steps < MAX_STAGE_STEPS) {
    if (msLeft(clock) <= 0) throw timedOut(clock);
    const result = await postJson<{ batch: BatchView }>("/api/generate", { examId, batchIndex }, { timeoutMs: msLeft(clock) + RESPONSE_GRACE_MS });
    if (result.ok) {
      steps++;
      events.onBatch(result.data.batch);
      if (result.data.batch.stage === "done" || result.data.batch.stage === "failed") return result.data.batch;
      continue;
    }
    if (result.data.kind === "run_timed_out") throw new GenerationTimedOut(result.error);
    if (result.data.kind === "client_timeout") throw timedOut(clock);
    if (result.status === 409 && result.data.busy === true) {
      events.onBatch(result.data.batch as BatchView);
      await sleep(Math.min(BUSY_POLL_MS, Math.max(0, msLeft(clock))));
      continue;
    }
    if (result.data.retryable === true && transient < MAX_TRANSIENT_RETRIES) {
      transient++;
      clock.lastProblem = result.error;
      const wait = typeof result.data.retryAfterMs === "number" && result.data.retryAfterMs > 0 ? result.data.retryAfterMs : 2_000 * 2 ** transient;
      // Waiting past the deadline would only end in the timeout, so say so now.
      if (wait >= msLeft(clock)) throw timedOut(clock);
      await sleep(wait);
      continue;
    }
    throw new Error(result.error);
  }
  throw new Error(`Batch ${batchIndex + 1} didn't finish after ${MAX_STAGE_STEPS} stages.`);
}

async function withConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
