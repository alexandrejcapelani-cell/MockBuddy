"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchView, ExamProgress } from "@/lib/generation/context";
import { formatUsd } from "@/lib/ai/pricing";
import { type GenerationResult, MAX_PARALLEL_BATCHES, runGeneration } from "@/lib/generation/runner";

const STAGE_TEXT: Record<BatchView["stage"], string> = {
  draft: "drafting",
  draft_retry: "redrafting invalid questions",
  critique: "examiner review",
  revise: "revising",
  done: "done",
  failed: "failed",
};

/** Plain generation screen until phase 6 brings the slot machine. Starts generating on load. */
export function SpinRunner({ initial }: { initial: ExamProgress }) {
  const [batches, setBatches] = useState<Map<number, BatchView>>(() => new Map(initial.batches.map((b) => [b.batchIndex, b])));
  const [phase, setPhase] = useState<"batches" | "topup" | "finalizing" | "done" | "error">(initial.status === "ready" ? "done" : "batches");
  const [result, setResult] = useState<GenerationResult | null>(
    initial.status === "ready" ? { requested: initial.questionCount, generated: initial.generated, short: Math.max(0, initial.questionCount - initial.generated) } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  const run = useCallback(async () => {
    setError(null);
    setPhase("batches");
    setStartedAt(Date.now());
    setFinishedAt(null);
    try {
      const outcome = await runGeneration(initial.examId, {
        onBatch: (batch) => setBatches((current) => new Map(current).set(batch.batchIndex, batch)),
        onPhase: setPhase,
      });
      setResult(outcome);
      setPhase("done");
    } catch (caught) {
      setError((caught as Error).message);
      setPhase("error");
    } finally {
      setFinishedAt(Date.now());
    }
  }, [initial.examId]);

  useEffect(() => {
    // The ref keeps React's development double-mount from starting two runs.
    if (started.current || initial.status === "ready") return;
    started.current = true;
    void run();
  }, [initial.status, run]);

  useEffect(() => {
    if (phase === "done" || phase === "error") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [phase]);

  const list = [...batches.values()].sort((a, b) => a.batchIndex - b.batchIndex);
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
      <p aria-live="polite" className="text-lg font-semibold">
        {statusLine(phase, list, result)}
      </p>
      {result && result.short > 0 && (
        <p role="status">
          {result.short} question{result.short === 1 ? "" : "s"} short: some drafts failed the checks twice and the
          replacements ran out.
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{error}</p>
          <button type="button" className="underline" onClick={() => void run()}>
            Resume generation
          </button>
        </div>
      )}

      <table className="w-full border-collapse text-sm">
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
                <td className="py-1 pr-3">{[...new Set(batch.slots.map((s) => s.topicLabel))].join(" · ")}</td>
                <td className="py-1 pr-3">
                  {STAGE_TEXT[batch.stage]}
                  {batch.error && batch.stage !== "done" && <span className="block text-destructive">{batch.error}</span>}
                </td>
                <td className="py-1 pr-3 tabular-nums">
                  {batch.stage === "done" || batch.stage === "failed" ? `${kept} of ${batch.slots.length}` : "–"}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{(modelMs / 1000).toFixed(1)} s</td>
                <td className="py-1 text-right tabular-nums">{batch.metrics.reduce((sum, m) => sum + m.retries429, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="text-sm text-muted-foreground">
        {elapsed !== null && `Wall clock ${elapsed.toFixed(1)} s · `}
        {totals.calls} model calls · {totals.retries429} rate-limit retries ({(totals.waitedMs / 1000).toFixed(1)} s waiting) ·{" "}
        {totals.inputTokens.toLocaleString("en")} input / {totals.outputTokens.toLocaleString("en")} output tokens · about{" "}
        {formatUsd(totals.costUsd)} · up to{" "}
        {MAX_PARALLEL_BATCHES} batches at once
      </p>

      {phase === "done" && (
        <p>
          <Link href={`/debug/exam/${initial.examId}`} className="font-medium underline">
            Review the questions and explanations
          </Link>
        </p>
      )}
    </div>
  );
}

function statusLine(phase: string, batches: BatchView[], result: GenerationResult | null): string {
  if (phase === "done" && result) return `JACKPOT — ${result.generated} questions ready`;
  if (phase === "error") return "Generation stopped.";
  if (phase === "finalizing") return "Shuffling the deck…";
  const drafting = batches.find((b) => b.stage === "draft" || b.stage === "draft_retry");
  if (drafting && batches.some((b) => b.metrics.length > 0)) return `Dealing from ${drafting.slots[0]?.topicLabel ?? "your material"}…`;
  if (batches.some((b) => b.stage === "critique" || b.stage === "revise")) return "Checking the deck…";
  if (phase === "topup") return "Dealing replacement cards…";
  return "Reading the house rules…";
}
