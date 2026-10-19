import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MathText } from "@/components/math-text";
import { formatMarks, QuestionReveal, verdictText } from "@/components/question-reveal";
import { computeResults } from "@/lib/exam/results";
import { loadExamForTaking } from "@/lib/exam/taking";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import { RequestError } from "@/lib/http";
import { RegenerateButton } from "./regenerate-button";

export const dynamic = "force-dynamic";

/** Screen 4, plain until phase 6: the payout, the topic board and every question reviewed. */
export default async function ResultsPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  if (!z.uuid().safeParse(examId).success) notFound();
  const { exam, questions } = await loadExamForTaking(examId).catch((error: unknown) => {
    if (error instanceof RequestError && error.status === 404) notFound();
    throw error;
  });
  const results = computeResults(questions);
  const unanswered = results.total - results.answered;

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-6">
      <header className="space-y-1">
        <Link href={`/exam/${examId}`} className="text-sm underline">
          ← Back to the exam
        </Link>
        <h1 className="text-2xl font-semibold">Results</h1>
        <p className="text-sm text-muted-foreground">
          {results.total} questions · {DIFFICULTY_NAMES[exam.difficulty]}
        </p>
      </header>

      <section aria-labelledby="score-heading" className="space-y-1">
        <h2 id="score-heading" className="sr-only">
          Score
        </h2>
        <p className="text-4xl font-semibold tabular-nums">
          {formatMarks(results.awardedMarks)} / {formatMarks(results.totalMarks)} marks
        </p>
        <p className="text-lg tabular-nums">{Math.round(results.percent)}%</p>
        <p className="text-sm text-muted-foreground">
          {results.correct} of {results.total} questions correct
          {unanswered > 0 && (
            <>
              {" "}
              · {unanswered} not answered (counted as zero).{" "}
              <Link href={`/exam/${examId}`} className="underline">
                Answer them
              </Link>
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="topics-heading" className="space-y-2">
        <h2 id="topics-heading" className="text-lg font-semibold">
          By topic
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-3">Topic</th>
              <th className="py-1 pr-3 text-right">Correct</th>
              <th className="py-1 pr-3 text-right">Marks</th>
              <th className="py-1 pr-3 text-right">Accuracy</th>
              <th className="py-1">
                <span className="sr-only">Flag</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.topics.map((row) => (
              <tr key={row.topic} className="border-b">
                <td className="py-1 pr-3">{row.topic}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {row.correct} of {row.questions}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {row.answered === 0 ? "–" : `${formatMarks(row.awarded)} / ${formatMarks(row.marks)}`}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {row.accuracy === null ? "not answered" : `${Math.round(row.accuracy * 100)}%`}
                </td>
                <td className="py-1 font-semibold">
                  {row.flag === "HOT" && "HOT · strongest"}
                  {row.flag === "COLD" && "COLD · weakest"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">Accuracy is marks earned over marks available on the questions you answered.</p>
      </section>

      <RegenerateButton examId={examId} />

      <section aria-labelledby="review-heading" className="space-y-4">
        <h2 id="review-heading" className="text-lg font-semibold">
          Every question
        </h2>
        <ol className="space-y-6">
          {questions.map((view) => (
            <li key={view.id} className="space-y-3 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Q{view.ordinal}</span> · {view.topicLabel} · {verdictText(view)}
              </p>
              <MathText text={view.prompt} className="block whitespace-pre-wrap" />
              {view.answer ? (
                <QuestionReveal view={view} />
              ) : (
                <p className="text-sm">
                  Not answered yet, so its answer stays hidden.{" "}
                  <Link href={`/exam/${examId}`} className="underline">
                    Answer it
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <RegenerateButton examId={examId} />
    </main>
  );
}
