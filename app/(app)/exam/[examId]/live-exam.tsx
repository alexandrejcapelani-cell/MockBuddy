"use client";

import { useCallback, useRef, useState } from "react";
import { RunTrouble } from "@/components/run-trouble";
import type { QuestionView } from "@/lib/exam/view";
import type { ExamProgress } from "@/lib/generation/context";
import { useGenerationRun } from "@/lib/generation/use-generation-run";
import { getJson } from "@/lib/upload-client";
import { ExamTaker } from "./exam-taker";

/**
 * The exam while it is still being generated: this page carries the run on and reads the
 * questions again each time a batch is saved, so the student answers the first cards while
 * later ones are dealt. Results open once the mock is finished.
 */
export function LiveExam({ progress, initial }: { progress: ExamProgress; initial: QuestionView[] }) {
  const examId = progress.examId;
  const [questions, setQuestions] = useState(initial);
  const [generating, setGenerating] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Batches can finish together; only the latest read is applied.
  const reads = useRef(0);

  const reload = useCallback(async () => {
    const read = ++reads.current;
    const result = await getJson<{ status: string; questions: QuestionView[] }>(`/api/exams/${examId}/questions`, { timeoutMs: 30_000 });
    if (read !== reads.current) return;
    if (!result.ok) {
      setLoadError(`Couldn't load the new questions: ${result.error}`);
      return;
    }
    setLoadError(null);
    setQuestions(result.data.questions);
    setGenerating(result.data.status === "generating");
  }, [examId]);

  const run = useGenerationRun(progress, reload);
  const dealt = questions.length;

  return (
    <div className="space-y-6">
      {generating && (
        <p aria-live="polite" className="panel p-4 text-center text-cream tabular">
          {run.phase === "timed_out" || run.phase === "error"
            ? `${dealt} of ${progress.questionCount} questions dealt. Dealing has stopped.`
            : dealt === 0
              ? `Dealing your first cards… the rest of the ${progress.questionCount} follow while you play.`
              : `${dealt} of ${progress.questionCount} questions dealt. The rest are on their way.`}
        </p>
      )}
      {loadError && (
        <p role="alert" className="panel p-4 text-center text-error">
          {loadError}{" "}
          <button type="button" className="btn-quiet ml-2" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      )}
      <RunTrouble
        run={run}
        questionCount={progress.questionCount}
        keepLabel={(ready) => `Finish with the ${ready} ready question${ready === 1 ? "" : "s"}`}
      />
      {dealt > 0 && <ExamTaker examId={examId} questions={questions} dealing={generating ? progress.questionCount : null} />}
    </div>
  );
}
