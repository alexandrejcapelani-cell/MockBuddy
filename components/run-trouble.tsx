"use client";

import type { GenerationRun } from "@/lib/generation/use-generation-run";
import { RUN_LIMIT_MINUTES } from "@/lib/generation/run-limit";

/**
 * What a generation run needs from the student when it stops early: Resume after an error;
 * after the time limit, Retry or keep the questions that are ready.
 */
export function RunTrouble({
  run,
  questionCount,
  keepLabel,
  onKept,
}: {
  run: GenerationRun;
  questionCount: number;
  /** The keep-ready button, given how many questions are ready. */
  keepLabel: (ready: number) => string;
  onKept?: () => void;
}) {
  if (run.phase === "error" && run.error) {
    return (
      <div role="alert" className="panel space-y-3 p-4 text-center">
        <p className="text-error">{run.error}</p>
        <button type="button" className="btn-gold" onClick={run.resume}>
          Resume generation
        </button>
      </div>
    );
  }
  if (run.phase !== "timed_out") return null;
  return (
    <div role="alert" className="panel space-y-4 p-5 text-center">
      <p className="text-lg font-semibold text-cream">{run.timeoutMessage}</p>
      <p className="text-cream">
        {run.ready > 0 ? `${run.ready} of ${questionCount} questions are ready and kept.` : "No questions were finished yet."}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" className="btn-gold" disabled={run.acting} onClick={() => void run.retry()}>
          Retry
        </button>
        {run.ready > 0 && (
          <button
            type="button"
            className="btn-quiet"
            disabled={run.acting}
            onClick={() => void run.keepReady().then((kept) => kept && onKept?.())}
          >
            {keepLabel(run.ready)}
          </button>
        )}
      </div>
      <p className="text-sm text-dim">
        Retry carries on from where it stopped, with another {RUN_LIMIT_MINUTES} minutes. It doesn&rsquo;t use another free mock.
      </p>
    </div>
  );
}
