"use client";

import Link from "next/link";
import { useState } from "react";
import { MathText } from "@/components/math-text";
import { OPTION_LETTERS, QuestionReveal, verdictText } from "@/components/question-reveal";
import { type QuestionView, questionState } from "@/lib/exam/view";
import { postJson } from "@/lib/upload-client";

const STATE_LABEL = { unanswered: "not answered", correct: "correct", wrong: "wrong" } as const;
// Shown in the navigator next to the number; the button's name says the verdict in words.
const STATE_MARK = { unanswered: "·", correct: "✓", wrong: "✗" } as const;

/** Screen 3, plain until phase 6: one question at a time, marked the moment it's answered. */
export function ExamTaker({ examId, initial }: { examId: string; initial: QuestionView[] }) {
  const [views, setViews] = useState(initial);
  const [index, setIndex] = useState(() => Math.max(0, initial.findIndex((q) => !q.answer)));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const view = views[index];
  const answered = views.filter((q) => q.answer).length;

  async function submit(response: string) {
    setPending(view.id);
    setError(null);
    const result = await postJson<{ question: QuestionView }>(
      "/api/grade",
      { examId, questionId: view.id, response },
      { withApiKey: true },
    );
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const graded = result.data.question;
    setViews((current) => current.map((q) => (q.id === graded.id ? graded : q)));
    setAnnouncement(`Question ${graded.ordinal}: ${announce(graded)}`);
  }

  function go(to: number) {
    setIndex(to);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Questions">
        <ol className="flex flex-wrap gap-1">
          {views.map((q, i) => {
            const state = questionState(q);
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={`Question ${q.ordinal}, ${q.answer ? verdictText(q) : STATE_LABEL[state]}`}
                  className={`w-11 rounded border px-1 py-1 text-sm tabular-nums ${i === index ? "border-2 border-foreground font-semibold" : ""} ${state === "wrong" ? "opacity-70" : ""}`}
                >
                  {q.ordinal}
                  <span aria-hidden="true"> {STATE_MARK[state]}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-1 text-sm text-muted-foreground">
          {answered} of {views.length} answered
        </p>
      </nav>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <article aria-labelledby="question-heading" className="space-y-4 rounded-lg border p-4">
        <header>
          <h2 id="question-heading" className="font-semibold">
            Question {view.ordinal} of {views.length}
          </h2>
          <p className="text-sm text-muted-foreground">
            {view.marks} mark{view.marks === 1 ? "" : "s"} · {view.topicLabel}
          </p>
        </header>
        <MathText text={view.prompt} className="block whitespace-pre-wrap text-base" />

        {!view.answer && view.type === "mcq" && view.options && (
          <ul className="space-y-2" aria-label="Options">
            {view.options.map((option, i) => (
              <li key={i}>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void submit(String(i))}
                  className="w-full rounded border p-2 text-left disabled:opacity-60"
                >
                  <span className="font-medium">{OPTION_LETTERS[i]}.</span> <MathText text={option} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!view.answer && view.type !== "mcq" && (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(drafts[view.id] ?? "");
            }}
          >
            <label htmlFor={`answer-${view.id}`} className="block text-sm font-medium">
              Your answer{view.type === "numerical" && view.unit ? ` (in ${view.unit})` : ""}
            </label>
            {view.type === "short" ? (
              <textarea
                id={`answer-${view.id}`}
                rows={6}
                value={drafts[view.id] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [view.id]: e.target.value })}
                className="w-full rounded border p-2"
              />
            ) : (
              <input
                id={`answer-${view.id}`}
                inputMode="decimal"
                autoComplete="off"
                value={drafts[view.id] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [view.id]: e.target.value })}
                className="w-48 rounded border p-2 tabular-nums"
              />
            )}
            <button type="submit" disabled={pending !== null} className="block rounded border px-3 py-1 font-medium disabled:opacity-60">
              {pending === view.id ? (view.type === "short" ? "Marking…" : "Checking…") : "Submit answer"}
            </button>
          </form>
        )}

        {pending === view.id && view.type === "mcq" && <p>Checking…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}

        {view.answer && (
          <section aria-labelledby="verdict-heading" className="space-y-3">
            <h3 id="verdict-heading" className="text-lg font-semibold">
              <span aria-hidden="true">{view.answer.isCorrect ? "✓ " : "✗ "}</span>
              {verdictText(view)}
            </h3>
            <QuestionReveal view={view} />
          </section>
        )}
      </article>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={index === 0} onClick={() => go(index - 1)} className="rounded border px-3 py-1 disabled:opacity-50">
          Previous
        </button>
        <button
          type="button"
          disabled={index === views.length - 1}
          onClick={() => go(index + 1)}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          Next
        </button>
        <Link href={`/exam/${examId}/results`} className="ml-auto font-medium underline">
          {answered === views.length ? "See your results" : `See results (${views.length - answered} unanswered)`}
        </Link>
      </div>
    </div>
  );
}

function announce(view: QuestionView): string {
  const verdict = verdictText(view);
  if (view.type === "mcq" && view.answer && !view.answer.isCorrect && view.reveal?.correctOption != null) {
    return `${verdict}. The correct answer is ${OPTION_LETTERS[view.reveal.correctOption]}.`;
  }
  return `${verdict}.`;
}
