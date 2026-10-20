"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchView, ExamProgress } from "./context.ts";
import { GenerationCancelled, type GenerationResult, GenerationTimedOut, runGeneration } from "./runner.ts";
import { RunTimedOutError } from "./run-limit.ts";
import { postJson } from "../upload-client.ts";

export type RunPhase = "batches" | "topup" | "finalizing" | "done" | "error" | "timed_out";

export interface GenerationRun {
  batches: Map<number, BatchView>;
  /** Batch indexes in the order they finished. */
  completionOrder: number[];
  phase: RunPhase;
  error: string | null;
  timeoutMessage: string | null;
  result: GenerationResult | null;
  /** Questions saved so far, ready to answer. */
  ready: number;
  /** Retry or keep-ready is being sent. */
  acting: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  /** Carry on after an error. */
  resume(): void;
  /** After a timeout: a fresh run for the same mock, from where it stopped. */
  retry(): Promise<void>;
  /** After a timeout: end the run with the questions that are ready. True if it ended. */
  keepReady(): Promise<boolean>;
}

const finished = (batch: BatchView) => batch.stage === "done" || batch.stage === "failed";

/**
 * Runs a mock's generation from the screen that's open (the spin, or the exam while it
 * streams in) and tracks it for display. Starts on load unless the mock is finished or its
 * time ran out; closing the screen cancels the run, and the next screen picks it up.
 * `onSaved` is called whenever questions may have been added: a batch finished, or the run
 * ended.
 */
export function useGenerationRun(initial: ExamProgress, onSaved?: () => void): GenerationRun {
  const examId = initial.examId;
  // Opened (or reloaded) after the run's time ran out: offer Retry rather than starting again.
  const alreadyTimedOut = initial.status === "generating" && initial.runMsLeft <= 0;
  const [batches, setBatches] = useState<Map<number, BatchView>>(() => new Map(initial.batches.map((b) => [b.batchIndex, b])));
  const [completionOrder, setCompletionOrder] = useState<number[]>(() => initial.batches.filter(finished).map((b) => b.batchIndex));
  const [phase, setPhase] = useState<RunPhase>(initial.status !== "generating" ? "done" : alreadyTimedOut ? "timed_out" : "batches");
  const [timeoutMessage, setTimeoutMessage] = useState<string | null>(alreadyTimedOut ? new RunTimedOutError().message : null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(
    initial.status === "generating"
      ? null
      : { requested: initial.questionCount, generated: initial.generated, short: Math.max(0, initial.questionCount - initial.generated) },
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const saved = useRef(onSaved);
  useEffect(() => {
    saved.current = onSaved;
  }, [onSaved]);

  const onBatch = useCallback((batch: BatchView) => {
    setBatches((current) => new Map(current).set(batch.batchIndex, batch));
    if (finished(batch)) {
      setCompletionOrder((order) => (order.includes(batch.batchIndex) ? order : [...order, batch.batchIndex]));
      if (batch.stage === "done") saved.current?.();
    }
  }, []);

  const run = useCallback(
    async (progress?: ExamProgress) => {
      controller.current?.abort();
      const own = new AbortController();
      controller.current = own;
      setError(null);
      setTimeoutMessage(null);
      setPhase("batches");
      setStartedAt(Date.now());
      setFinishedAt(null);
      try {
        setResult(await runGeneration(examId, { onBatch, onPhase: setPhase }, { progress, signal: own.signal }));
        setPhase("done");
        saved.current?.();
      } catch (caught) {
        if (caught instanceof GenerationCancelled) return;
        if (caught instanceof GenerationTimedOut) {
          setTimeoutMessage(caught.message);
          setPhase("timed_out");
        } else {
          setError((caught as Error).message);
          setPhase("error");
        }
      }
      setFinishedAt(Date.now());
    },
    [examId, onBatch],
  );

  useEffect(() => {
    if (initial.status !== "generating" || alreadyTimedOut) return;
    // In development React mounts twice: the first run is cancelled and this one carries on.
    void run();
    return () => controller.current?.abort();
  }, [initial.status, alreadyTimedOut, run]);

  async function retry() {
    setActing(true);
    const restarted = await postJson<ExamProgress>(`/api/exams/${examId}/retry`, {});
    setActing(false);
    if (!restarted.ok) {
      setTimeoutMessage(`Couldn't restart: ${restarted.error}`);
      return;
    }
    void run(restarted.data);
  }

  async function keepReady() {
    setActing(true);
    const stopped = await postJson<GenerationResult>(`/api/exams/${examId}/stop`, {});
    setActing(false);
    if (!stopped.ok) {
      setTimeoutMessage(stopped.error);
      return false;
    }
    setResult(stopped.data);
    setPhase("done");
    saved.current?.();
    return true;
  }

  const list = [...batches.values()];
  const accepted = list.filter((b) => b.stage === "done").reduce((sum, b) => sum + b.outcomes.filter((o) => o.status === "accepted").length, 0);

  return {
    batches,
    completionOrder,
    phase,
    error,
    timeoutMessage,
    result,
    ready: result?.generated ?? accepted,
    acting,
    startedAt,
    finishedAt,
    resume: () => void run(),
    retry,
    keepReady,
  };
}
