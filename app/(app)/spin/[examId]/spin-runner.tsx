"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlotMachine } from "@/components/slot-machine";
import { formatUsd } from "@/lib/ai/pricing";
import type { BatchView, ExamProgress } from "@/lib/generation/context";
import { type GenerationResult, MAX_PARALLEL_BATCHES, runGeneration } from "@/lib/generation/runner";

const STAGE_TEXT: Record<BatchView["stage"], string> = {
  draft: "drafting",
  draft_retry: "redrafting invalid questions",
  critique: "examiner review",
  revise: "revising",
  done: "done",
  failed: "failed",
};

type Phase = "batches" | "topup" | "finalizing" | "done" | "error";

/**
 * Screen 2. Starts generating on load (a first mock and a regenerated one alike) and plays
 * the slot machine from batch progress. The machine is decorative: the exam is linked the
 * moment generation finishes, whatever the reels are doing.
 */
export function SpinRunner({ initial }: { initial: ExamProgress }) {
  const [batches, setBatches] = useState<Map<number, BatchView>>(() => new Map(initial.batches.map((b) => [b.batchIndex, b])));
  const [completionOrder, setCompletionOrder] = useState<number[]>(() =>
    initial.batches.filter((b) => b.stage === "done" || b.stage === "failed").map((b) => b.batchIndex),
  );
  const [phase, setPhase] = useState<Phase>(initial.status === "generating" ? "batches" : "done");
  const [result, setResult] = useState<GenerationResult | null>(
    initial.status === "generating"
      ? null
      : { requested: initial.questionCount, generated: initial.generated, short: Math.max(0, initial.questionCount - initial.generated) },
  );
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  const onBatch = useCallback((batch: BatchView) => {
    setBatches((current) => new Map(current).set(batch.batchIndex, batch));
    if (batch.stage === "done" || batch.stage === "failed") {
      setCompletionOrder((order) => (order.includes(batch.batchIndex) ? order : [...order, batch.batchIndex]));
    }
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setPhase("batches");
    setStartedAt(Date.now());
    setFinishedAt(null);
    try {
      setResult(await runGeneration(initial.examId, { onBatch, onPhase: setPhase }));
      setPhase("done");
    } catch (caught) {
      setError((caught as Error).message);
      setPhase("error");
    } finally {
      setFinishedAt(Date.now());
    }
  }, [initial.examId, onBatch]);

  useEffect(() => {
    // The ref keeps React's development double-mount from starting two runs.
    if (started.current || initial.status !== "generating") return;
    started.current = true;
    void run();
  }, [initial.status, run]);

  useEffect(() => {
    if (phase === "done" || phase === "error") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [phase]);

  const list = [...batches.values()].sort((a, b) => a.batchIndex - b.batchIndex);
  const finished = list.filter((b) => b.stage === "done" || b.stage === "failed").length;
  const jackpot = phase === "done" && result !== null && result.generated > 0;
  const progress = jackpot ? 1 : list.length === 0 ? 0 : Math.min(0.95, finished / list.length);

  // The reels show the student's own topics; each locks on the topic of a finished batch.
  const topics = useMemo(() => [...new Set(initial.batches.flatMap((b) => b.slots.map((s) => s.topicLabel)))], [initial.batches]);
  const landOn = useMemo(() => {
    const picks = completionOrder.map((index) => batches.get(index)?.slots[0]?.topicLabel).filter((t): t is string => Boolean(t));
    return [0, 1, 2].map((reel) => picks[reel] ?? topics[reel % Math.max(1, topics.length)] ?? "Your material") as [string, string, string];
  }, [completionOrder, batches, topics]);
  // Reels lock left to right as the share of finished batches passes a third, two thirds,
  // and (the last reel) when everything is finished.
  const locked = jackpot ? 3 : Math.min(2, Math.floor((finished / Math.max(1, list.length)) * 3 + 1e-9));

  const elapsed = startedAt ? ((finishedAt ?? now) - startedAt) / 1000 : null;
  const totals = list.flatMap((b) => b.metrics).reduce(
    (acc, m) => ({
      calls: acc.calls + 1,
      retries429: acc.retries429 + m.retries429,
      waitedMs: acc.waitedMs + m.waitedMs,
      inputTokens: acc.inputTokens + m.inputTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
      costUsd: acc.costUsd + (m.estimatedCostUsd ?? 0),
    }),
    { calls: 0, retries429: 0, waitedMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );

  return (
    <div className="space-y-6">
      <SlotMachine topics={topics} locked={locked} landOn={landOn} progress={progress} jackpot={jackpot} />

      <p aria-live="polite" className="neon text-center text-2xl font-bold sm:text-3xl">
        {statusLine(phase, list, result)}
      </p>

      {result && result.short > 0 && (
        <p role="status" className="text-center text-dim">
          {result.short} question{result.short === 1 ? "" : "s"} short: some drafts failed the checks twice and the
          replacements ran out.
        </p>
      )}
      {error && (
        <div role="alert" className="panel space-y-3 p-4 text-center">
          <p className="text-error">{error}</p>
          <button type="button" className="btn-gold" onClick={() => void run()}>
            Resume generation
          </button>
        </div>
      )}

      {phase === "done" && result && result.generated > 0 && (
        <p className="flex flex-wrap items-center justify-center gap-5">
          <Link href={`/exam/${initial.examId}`} className="btn-gold text-lg no-underline">
            Take the exam
          </Link>
          <Link href={`/debug/exam/${initial.examId}`} className="text-sm">
            Review every question and answer (spoilers)
          </Link>
        </p>
      )}

      <details className="panel p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Batch details and timings</summary>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-3">Batch</th>
              <th className="py-1 pr-3">Topics</th>
              <th className="py-1 pr-3">Stage</th>
              <th className="py-1 pr-3">Kept</th>
              <th className="py-1 pr-3 text-right">Model time</th>
              <th className="py-1 text-right">429 retries</th>
            </tr>
          </thead>
          <tbody>
            {list.map((batch) => {
              const kept = batch.outcomes.filter((o) => o.status === "accepted").length;
              const modelMs = batch.metrics.reduce((sum, m) => sum + m.durationMs, 0);
              return (
                <tr key={batch.batchIndex} className="border-b align-top">
                  <td className="py-1 pr-3">
                    {batch.batchIndex + 1}
                    {batch.kind === "topup" && " (top-up)"}
                  </td>
                  <td className="py-1 pr-3 text-dim">{[...new Set(batch.slots.map((s) => s.topicLabel))].join(" · ")}</td>
                  <td className="py-1 pr-3">
                    {STAGE_TEXT[batch.stage]}
                    {batch.error && batch.stage !== "done" && <span className="block text-error">{batch.error}</span>}
                  </td>
                  <td className="py-1 pr-3 tabular">{batch.stage === "done" || batch.stage === "failed" ? `${kept} of ${batch.slots.length}` : "–"}</td>
                  <td className="py-1 pr-3 text-right tabular">{(modelMs / 1000).toFixed(1)} s</td>
                  <td className="py-1 text-right tabular">{batch.metrics.reduce((sum, m) => sum + m.retries429, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-dim">
          {elapsed !== null && `Wall clock ${elapsed.toFixed(1)} s · `}
          {totals.calls} model calls · {totals.retries429} rate-limit retries ({(totals.waitedMs / 1000).toFixed(1)} s waiting) ·{" "}
          {totals.inputTokens.toLocaleString("en")} input / {totals.outputTokens.toLocaleString("en")} output tokens · about{" "}
          {formatUsd(totals.costUsd)} · up to {MAX_PARALLEL_BATCHES} batches at once
        </p>
      </details>
    </div>
  );
}

function statusLine(phase: Phase, batches: BatchView[], result: GenerationResult | null): string {
  if (phase === "done" && result) return result.generated > 0 ? `JACKPOT — ${result.generated} questions ready` : "No questions survived the checks";
  if (phase === "error") return "The dealer stopped. See below.";
  if (phase === "finalizing") return "Shuffling the deck…";
  const drafting = batches.find((b) => b.stage === "draft" || b.stage === "draft_retry");
  if (drafting && batches.some((b) => b.metrics.length > 0)) return `Dealing from ${drafting.slots[0]?.topicLabel ?? "your material"}…`;
  if (batches.some((b) => b.stage === "critique" || b.stage === "revise")) return "Checking the deck…";
  if (phase === "topup") return "Dealing replacement cards…";
  return "Reading the house rules…";
}
