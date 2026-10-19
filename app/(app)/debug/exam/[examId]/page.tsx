import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MathText } from "@/components/math-text";
import { QUESTION_TYPE_NAMES } from "@/lib/blueprint/rules";
import { db } from "@/lib/db";
import { chunks, exams, generationBatches, questions } from "@/lib/db/schema";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import { formatCost } from "@/lib/ai/pricing";
import type { StageMetrics } from "@/lib/generation/types";

// Phase 3 quality review: every generated question with its answer, every explanation,
// where it came from, what the examiner pass said, and how long each stage took.
export const dynamic = "force-dynamic";

const LETTERS = "ABCDEFGH";

export default async function ExamReviewPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  if (!z.uuid().safeParse(examId).success) notFound();
  const [exam] = await db().select().from(exams).where(eq(exams.id, examId));
  if (!exam) notFound();

  const [rows, batches] = await Promise.all([
    db().select().from(questions).where(eq(questions.examId, examId)).orderBy(asc(questions.ordinal)),
    db().select().from(generationBatches).where(eq(generationBatches.examId, examId)).orderBy(asc(generationBatches.batchIndex)),
  ]);
  const sources = rows.length
    ? await db()
        .select({ id: chunks.id, sectionLabel: chunks.sectionLabel })
        .from(chunks)
        .where(inArray(chunks.id, [...new Set(rows.map((q) => q.sourceChunkId))]))
    : [];
  const sectionOf = new Map(sources.map((s) => [s.id, s.sectionLabel]));

  // Slot ordinals were renumbered at the end; match each question to its verdict through
  // the batches' accepted outcomes, which are in the same order.
  const acceptedSlots = batches
    .flatMap((b) => b.outcomes.filter((o) => o.status === "accepted").map((o) => ({ slot: o.slot, revised: o.revised, batch: b })))
    .sort((a, b) => a.slot - b.slot);
  const dropped = batches.flatMap((b) => b.outcomes.filter((o) => o.status === "dropped").map((o) => ({ ...o, batch: b.batchIndex })));
  const metrics = batches.flatMap((b) => b.metrics.map((m) => ({ ...m, batch: b.batchIndex })));
  const lastUpdate = batches.reduce((latest, b) => Math.max(latest, b.updatedAt.getTime()), exam.createdAt.getTime());

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 text-sm">
      <header className="space-y-1">
        <Link href="/app" className="underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">Mock review</h1>
        <p className="text-muted-foreground">
          {rows.length} of {exam.questionCount} questions · {DIFFICULTY_NAMES[exam.difficulty]} · {exam.status} · seed{" "}
          {exam.generationSeed}
        </p>
      </header>

      <TimingSummary metrics={metrics} wallClockMs={lastUpdate - exam.createdAt.getTime()} />

      <ol className="space-y-6">
        {rows.map((q, i) => {
          const origin = acceptedSlots[i];
          const verdict = origin?.batch.verdicts.find((v) => v.slot === origin.slot);
          return (
            <li key={q.id} className="space-y-3 rounded-lg border p-4">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Q{q.ordinal}</span> · {QUESTION_TYPE_NAMES[q.type]} · {q.marks} marks ·{" "}
                {q.topicLabel} · rated {q.difficulty}
                {origin?.revised && " · revised after examiner review"}
              </p>
              <MathText text={q.prompt} className="block whitespace-pre-wrap text-base" />

              {q.type === "mcq" && q.options && (
                <ul className="space-y-2">
                  {q.options.map((option, index) => {
                    const correct = index === q.correctOption;
                    const explanation = q.optionExplanations?.find((e) => e.index === index)?.explanation;
                    return (
                      <li key={index} className={correct ? "rounded border-2 border-foreground p-2" : "rounded border p-2"}>
                        <p>
                          <span className="font-medium">{LETTERS[index]}.</span> <MathText text={option} />
                          {correct && <strong> (correct)</strong>}
                        </p>
                        {explanation && (
                          <p className="mt-1 text-muted-foreground">
                            <MathText text={explanation} />
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {q.type === "short" && (
                <div className="space-y-1">
                  <p className="font-medium">Model answer</p>
                  <MathText text={q.expectedAnswer ?? ""} className="block whitespace-pre-wrap" />
                  <p className="font-medium">Rubric</p>
                  <ul className="list-disc pl-5">
                    {q.rubric?.map((point, j) => (
                      <li key={j}>
                        <MathText text={point.point} /> ({point.marks})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {q.type === "numerical" && (
                <p>
                  <span className="font-medium">Answer:</span> {q.numericAnswer} ± {q.tolerance}
                  {q.unit && ` ${q.unit}`}
                </p>
              )}

              <div className="space-y-1">
                <p className="font-medium">Why</p>
                <MathText text={q.correctExplanation} className="block whitespace-pre-wrap" />
              </div>
              <details>
                <summary className="cursor-pointer font-medium">Worked solution</summary>
                <MathText text={q.workedSolution} className="mt-1 block whitespace-pre-wrap" />
              </details>
              <p className="text-muted-foreground">
                Source: {sectionOf.get(q.sourceChunkId) ?? "removed material"} · “{q.sourceExcerpt}”
              </p>
              {verdict && verdict.instructions.length > 0 && (
                <div className="text-muted-foreground">
                  <p className="font-medium">Examiner asked for</p>
                  <ul className="list-disc pl-5">
                    {verdict.instructions.map((instruction, j) => (
                      <li key={j}>{instruction}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {dropped.length > 0 && (
        <section aria-labelledby="dropped-heading" className="space-y-2">
          <h2 id="dropped-heading" className="text-lg font-semibold">
            Dropped ({dropped.length})
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            {dropped.map((d) => (
              <li key={`${d.batch}-${d.slot}`}>
                Batch {d.batch + 1}, slot {d.slot}: {d.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function TimingSummary({ metrics, wallClockMs }: { metrics: (StageMetrics & { batch: number })[]; wallClockMs: number }) {
  const stages = ["draft", "draft_retry", "critique", "revise"] as const;
  const modelOf = (m: StageMetrics) => m.servedBy ?? m.model;
  // Runs recorded before the switch to Gemini have no thinking count.
  const thoughts = (calls: StageMetrics[]) => calls.reduce((sum, m) => sum + (m.thoughtTokens ?? 0), 0);
  const models = [...new Set(metrics.map(modelOf))].sort();
  return (
    <section aria-labelledby="timing-heading" className="space-y-2">
      <h2 id="timing-heading" className="text-lg font-semibold">
        Timings and cost
      </h2>
      <p>
        From creating the exam to its last batch finishing: {(wallClockMs / 1000).toFixed(1)} s. Longest single model call:{" "}
        {(Math.max(0, ...metrics.map((m) => m.durationMs)) / 1000).toFixed(1)} s (Vercel allows 60 s per request). Estimated cost
        of this run: {formatCost(metrics)}.
      </p>
      <div className="relative overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1 pr-3">Stage</th>
            <th className="py-1 pr-3">Model</th>
            <th className="py-1 pr-3 text-right">Calls</th>
            <th className="py-1 pr-3 text-right">Avg</th>
            <th className="py-1 pr-3 text-right">Max</th>
            <th className="py-1 pr-3 text-right">429 retries</th>
            <th className="py-1 pr-3 text-right">Output tokens</th>
            <th className="py-1 text-right">Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => {
            const calls = metrics.filter((m) => m.stage === stage);
            if (calls.length === 0) return null;
            const durations = calls.map((m) => m.durationMs);
            return (
              <tr key={stage} className="border-b">
                <td className="py-1 pr-3">{stage}</td>
                <td className="py-1 pr-3 font-mono text-xs">{[...new Set(calls.map(modelOf))].join(", ")}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{calls.length}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{(durations.reduce((a, b) => a + b, 0) / calls.length / 1000).toFixed(1)} s</td>
                <td className="py-1 pr-3 text-right tabular-nums">{(Math.max(...durations) / 1000).toFixed(1)} s</td>
                <td className="py-1 pr-3 text-right tabular-nums">{calls.reduce((sum, m) => sum + m.retries429, 0)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{calls.reduce((sum, m) => sum + m.outputTokens, 0).toLocaleString("en")}</td>
                <td className="py-1 text-right tabular-nums">{formatCost(calls)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="relative overflow-x-auto">
      <table className="w-full border-collapse">
        <caption className="mb-1 text-left font-medium">By model</caption>
        <thead>
          <tr className="border-b text-left">
            <th className="py-1 pr-3">Model</th>
            <th className="py-1 pr-3 text-right">Calls</th>
            <th className="py-1 pr-3 text-right">Input tokens</th>
            <th className="py-1 pr-3 text-right">Cached input read</th>
            <th className="py-1 pr-3 text-right">Output tokens</th>
            <th className="py-1 pr-3 text-right">Thinking tokens</th>
            <th className="py-1 text-right">Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const calls = metrics.filter((m) => modelOf(m) === model);
            return (
              <tr key={model} className="border-b">
                <td className="py-1 pr-3 font-mono text-xs">{model}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{calls.length}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{calls.reduce((sum, m) => sum + m.inputTokens, 0).toLocaleString("en")}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{calls.reduce((sum, m) => sum + m.cacheReadTokens, 0).toLocaleString("en")}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{calls.reduce((sum, m) => sum + m.outputTokens, 0).toLocaleString("en")}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{thoughts(calls).toLocaleString("en")}</td>
                <td className="py-1 text-right tabular-nums">{formatCost(calls)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="text-muted-foreground">
        Costs are estimates from list prices (lib/ai/pricing.ts). Topic labelling and blueprint calls are not part of a
        run; their model, time and cost show when each upload finishes, and in the server log.
      </p>
    </section>
  );
}
