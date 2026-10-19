import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ownsExam } from "@/lib/ownership";
import { MathText } from "@/components/math-text";
import { PayoutCounter } from "@/components/payout-counter";
import { formatMarks, QuestionReveal, verdictText } from "@/components/question-reveal";
import { computeResults } from "@/lib/exam/results";
import { loadExamForTaking } from "@/lib/exam/taking";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import { RequestError } from "@/lib/http";
import { freeMocksLeft } from "@/lib/generation/quota";
import { RegenerateButton } from "./regenerate-button";

export const dynamic = "force-dynamic";

/** Screen 4, the payout: the score, the topic board, REGENERATE and every question reviewed. */
export default async function ResultsPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const user = await requireUser();
  if (!z.uuid().safeParse(examId).success || !(await ownsExam(user.id, examId))) notFound();
  const { exam, questions } = await loadExamForTaking(examId).catch((error: unknown) => {
    if (error instanceof RequestError && error.status === 404) notFound();
    throw error;
  });
  const left = await freeMocksLeft(user.id);
  const results = computeResults(questions);
  const unanswered = results.total - results.answered;

  const decimals = Number.isInteger(results.awardedMarks) ? 0 : 1;

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-4xl font-bold text-gold-text">The payout</h1>
        <p className="text-dim">
          {results.total} questions · {DIFFICULTY_NAMES[exam.difficulty]} ·{" "}
          <Link href={`/exam/${examId}`}>back to the exam</Link>
        </p>
      </header>

      <section aria-labelledby="score-heading" className="wood-frame rounded-[2rem] p-5 sm:p-7">
        <h2 id="score-heading" className="sr-only">
          Score: {formatMarks(results.awardedMarks)} of {formatMarks(results.totalMarks)} marks, {Math.round(results.percent)}%
        </h2>
        <div aria-hidden="true" className="rounded-2xl bg-[#0a0f0c] px-4 py-6 text-center shadow-[inset_0_4px_18px_rgb(0_0_0/0.9)]">
          <p className="neon font-display text-6xl font-extrabold sm:text-7xl">
            <PayoutCounter value={results.awardedMarks} decimals={decimals} />
            <span className="text-3xl text-gold-text sm:text-4xl"> / {formatMarks(results.totalMarks)}</span>
          </p>
          <p className="mt-1 text-sm font-bold tracking-[0.3em] text-gold-text uppercase">marks</p>
          <p className="neon mt-3 text-3xl font-bold">
            <PayoutCounter value={Math.round(results.percent)} />%
          </p>
        </div>
        <p className="mt-4 text-center text-cream">
          {results.correct} of {results.total} questions correct
          {unanswered > 0 && (
            <>
              {" "}
              · {unanswered} not answered, counted as zero. <Link href={`/exam/${examId}`}>Answer them</Link>
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="topics-heading" className="space-y-3">
        <h2 id="topics-heading" className="text-2xl font-semibold">
          The board
        </h2>
        <div className="relative overflow-x-auto rounded-2xl border-2 border-gold/70 bg-felt">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-gold/70 text-left text-gold-text">
                <th scope="col" className="px-3 py-2">Topic</th>
                <th scope="col" className="px-3 py-2 text-right">Correct</th>
                <th scope="col" className="px-3 py-2 text-right">Marks</th>
                <th scope="col" className="px-3 py-2 text-right">Accuracy</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Hot or cold</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.topics.map((row) => (
                <tr key={row.topic} className="border-b border-gold/30 last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">{row.topic}</th>
                  <td className="px-3 py-2 text-right tabular">
                    {row.correct} of {row.questions}
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {row.answered === 0 ? "–" : `${formatMarks(row.awarded)} / ${formatMarks(row.marks)}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular">
                    {row.accuracy === null ? <span className="text-dim">not answered</span> : `${Math.round(row.accuracy * 100)}%`}
                  </td>
                  <td className="px-3 py-2">
                    {row.flag === "HOT" && (
                      <span className="rounded-full bg-chip-red px-3 py-1 text-xs font-bold tracking-[0.2em] text-cream">HOT</span>
                    )}
                    {row.flag === "COLD" && (
                      <span className="rounded-full border-2 border-chip-cream bg-felt-deep px-3 py-1 text-xs font-bold tracking-[0.2em] text-cream">
                        COLD
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-dim">
          Accuracy is marks earned over marks available on the questions you answered. HOT marks your strongest topic, COLD your
          weakest.
        </p>
      </section>

      <RegenerateButton examId={examId} freeMocksLeft={left} />

      <section aria-labelledby="review-heading" className="space-y-4">
        <h2 id="review-heading" className="text-2xl font-semibold">
          Every hand, reviewed
        </h2>
        <ol className="space-y-6">
          {questions.map((view) => (
            <li key={view.id} className="space-y-4">
              <div className="card-face space-y-2 p-5">
                <p className="text-sm text-card-ink-dim">
                  <span className="font-bold text-card-ink">Q{view.ordinal}</span> · {view.topicLabel} · {verdictText(view)}
                </p>
                <MathText text={view.prompt} className="block whitespace-pre-wrap" />
              </div>
              {view.answer ? (
                <div className="panel p-5">
                  <QuestionReveal view={view} />
                </div>
              ) : (
                <p className="text-sm text-dim">
                  Not answered yet, so its answer stays hidden. <Link href={`/exam/${examId}`}>Answer it</Link>
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <RegenerateButton examId={examId} freeMocksLeft={left} />
    </main>
  );
}
