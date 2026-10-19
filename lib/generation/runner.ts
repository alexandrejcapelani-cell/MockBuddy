// Browser-side driver for generation: runs the exam's batches in parallel, each through its
// stages one request at a time, then tops up dropped questions and finalizes.
// Every step is resumable: reloading the page starts again from what the database says.

import { postJson } from "../upload-client.ts";
import type { BatchView, ExamProgress } from "./context.ts";

/** Batches generating at once. Drop to 2 if rate limits regularly reject parallel drafts. */
export const MAX_PARALLEL_BATCHES = 4;
const MAX_TRANSIENT_RETRIES = 4;
const MAX_STAGE_STEPS = 10;
const BUSY_POLL_MS = 2_000;
const MAX_BUSY_POLLS = 120;
const MAX_TOPUP_ROUNDS = 3;

export interface RunnerEvents {
  onBatch(batch: BatchView): void;
  onPhase(phase: "batches" | "topup" | "finalizing"): void;
}

export interface GenerationResult {
  requested: number;
  generated: number;
  short: number;
}

export async function runGeneration(examId: string, events: RunnerEvents): Promise<GenerationResult> {
  events.onPhase("batches");
  await runPendingBatches(examId, await fetchProgress(examId), events);

  for (let round = 0; round < MAX_TOPUP_ROUNDS; round++) {
    const topup = await postJson<{ status: string; batchIndex?: number }>(`/api/exams/${examId}/topup`, {});
    if (!topup.ok) throw new Error(`Couldn't top up dropped questions: ${topup.error}`);
    if (topup.data.status === "created") {
      events.onPhase("topup");
      await runBatch(examId, topup.data.batchIndex!, events);
    } else if (topup.data.status === "pending") {
      // Another tab is still running a batch; help finish it.
      await runPendingBatches(examId, await fetchProgress(examId), events);
    } else {
      break;
    }
  }

  events.onPhase("finalizing");
  const result = await postJson<GenerationResult>(`/api/exams/${examId}/finalize`, {});
  if (!result.ok) throw new Error(`Couldn't finish the exam: ${result.error}`);
  return result.data;
}

export async function fetchProgress(examId: string): Promise<ExamProgress> {
  let response: Response;
  try {
    response = await fetch(`/api/exams/${examId}`, { cache: "no-store" });
  } catch (error) {
    throw new Error(`Couldn't reach the app server: ${(error as Error).message}`);
  }
  const body = (await response.json()) as ExamProgress & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}

async function runPendingBatches(examId: string, progress: ExamProgress, events: RunnerEvents) {
  progress.batches.forEach((batch) => events.onBatch(batch));
  const pending = progress.batches.filter((batch) => batch.stage !== "done" && batch.stage !== "failed");
  const results = await withConcurrency(pending, MAX_PARALLEL_BATCHES, (batch) => runBatch(examId, batch.batchIndex, events));
  // Batches usually fail for the same reason (a bad key, a rate limit), so say each reason once.
  const failures = new Set(results.flatMap((result) => (result.status === "rejected" ? [(result.reason as Error).message] : [])));
  if (failures.size > 0) throw new Error([...failures].join(" "));
}

/** Calls /api/generate until the batch is done or failed. */
async function runBatch(examId: string, batchIndex: number, events: RunnerEvents): Promise<BatchView> {
  let steps = 0;
  let transient = 0;
  let busy = 0;
  while (steps < MAX_STAGE_STEPS) {
    const result = await postJson<{ batch: BatchView }>("/api/generate", { examId, batchIndex }, { withApiKey: true });
    if (result.ok) {
      steps++;
      events.onBatch(result.data.batch);
      if (result.data.batch.stage === "done" || result.data.batch.stage === "failed") return result.data.batch;
      continue;
    }
    if (result.status === 409 && result.data.busy === true) {
      events.onBatch(result.data.batch as BatchView);
      if (++busy > MAX_BUSY_POLLS) throw new Error(`Batch ${batchIndex + 1} stayed busy for too long.`);
      await sleep(BUSY_POLL_MS);
      continue;
    }
    if (result.data.retryable === true && transient < MAX_TRANSIENT_RETRIES) {
      transient++;
      const wait = typeof result.data.retryAfterMs === "number" && result.data.retryAfterMs > 0 ? result.data.retryAfterMs : 2_000 * 2 ** transient;
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
