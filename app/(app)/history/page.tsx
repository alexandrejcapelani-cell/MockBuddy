import Link from "next/link";
import { ScoreChart, type ScorePoint } from "@/components/score-chart";
import { requireUser } from "@/lib/auth";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import { listHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Every past mock: when, how big, how hard, the score once taken, and the weakest topic. */
export default async function HistoryPage() {
  const user = await requireUser();
  const history = await listHistory(user.id);
  const taken = history.filter((row) => row.score !== null).reverse(); // oldest first for the chart
  const points: ScorePoint[] = taken.map((row) => ({
    id: row.examId,
    label: SHORT_DATE.format(row.createdAt),
    score: row.score!,
    detail: `${row.subject}: ${row.generated} questions, ${DIFFICULTY_NAMES[row.difficulty].toLowerCase()}`,
  }));

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-4xl font-bold text-gold-text">History</h1>
        <p className="text-dim">Every mock you&rsquo;ve been dealt, newest first.</p>
      </header>

      {history.length === 0 ? (
        <p className="panel p-6 text-center">
          No mocks yet. <Link href="/app">Deal your first one at the table</Link>.
        </p>
      ) : (
        <>
          {points.length > 1 && (
            <section className="panel p-5">
              <ScoreChart points={points} describedBy="history-table" />
            </section>
          )}

          <section aria-labelledby="history-heading" className="space-y-2">
            <h2 id="history-heading" className="sr-only">
              All mocks
            </h2>
            <div className="relative overflow-x-auto rounded-2xl border-2 border-gold/70 bg-felt">
              <table id="history-table" className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-gold/70 text-left text-gold-text">
                    <th scope="col" className="px-3 py-2">Date</th>
                    <th scope="col" className="px-3 py-2">Subject</th>
                    <th scope="col" className="px-3 py-2 text-right">Questions</th>
                    <th scope="col" className="px-3 py-2">Difficulty</th>
                    <th scope="col" className="px-3 py-2 text-right">Score</th>
                    <th scope="col" className="px-3 py-2">Weakest topic</th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => {
                    const href = row.status === "generating" ? `/spin/${row.examId}` : `/exam/${row.examId}/results`;
                    return (
                      <tr key={row.examId} className="border-b border-gold/30 last:border-b-0">
                        <th scope="row" className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                          {DATE.format(row.createdAt)}
                        </th>
                        <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.subject}</td>
                        <td className="px-3 py-2 text-right tabular">
                          {row.generated === row.questionCount || row.status === "generating"
                            ? row.questionCount
                            : `${row.generated} of ${row.questionCount}`}
                        </td>
                        <td className="px-3 py-2">{DIFFICULTY_NAMES[row.difficulty]}</td>
                        <td className="px-3 py-2 text-right tabular">
                          {row.status === "generating" ? (
                            <span className="text-dim">generating</span>
                          ) : row.score === null ? (
                            <span className="text-dim">not taken</span>
                          ) : (
                            <>
                              {Math.round(row.score)}%
                              {row.answered < row.generated && (
                                <span className="block text-xs text-dim">
                                  {row.answered} of {row.generated} answered
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2">{row.weakest.length > 0 ? row.weakest.join(", ") : <span className="text-dim">–</span>}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <Link href={href} aria-label={`Open the mock from ${DATE.format(row.createdAt)}`}>
                            {row.status === "generating" ? "Watch" : "Results"} →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
