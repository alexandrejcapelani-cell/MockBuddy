"use client";

import Link from "next/link";
import { useState } from "react";
import { ChipCascade } from "@/components/chip-cascade";
import { MathText } from "@/components/math-text";
import { OPTION_LETTERS, QuestionReveal, verdictText, verdictTone } from "@/components/question-reveal";
import { mergeDealt, type QuestionView, questionState } from "@/lib/exam/view";
import { playWin } from "@/lib/sound";
import { postJson } from "@/lib/upload-client";

const STATE_MARK = { unanswered: "", correct: "✓", wrong: "✗" } as const;
const BANNER = {
  correct: "bg-gold text-felt-deep",
  partial: "bg-wood text-cream",
  wrong: "bg-chip-red text-cream",
} as const;

/**
 * Screen 3, the hand: one question at a time, dealt as a playing card. Answering marks it
 * at once; the card flips to the verdict and the explanation block opens underneath.
 *
 * While the mock is still generating (`dealing` is its question count), `questions` grows as
 * batches are saved: new cards join in paper order, the rest show face down, and the card
 * being answered stays put.
 */
export function ExamTaker({ examId, questions, dealing }: { examId: string; questions: QuestionView[]; dealing: number | null }) {
  const [views, setViews] = useState(questions);
  const [received, setReceived] = useState(questions);
  if (questions !== received) {
    setReceived(questions);
    setViews((current) => mergeDealt(current, questions));
  }
  const [currentId, setCurrentId] = useState(() => (questions.find((q) => !q.answer) ?? questions[0]).id);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Which card animation runs: dealt in on arrival, flipped on answering, then none.
  const [motion, setMotion] = useState<{ id: string; kind: "deal" | "flip" } | null>(() => ({ id: currentId, kind: "deal" }));
  const [celebrate, setCelebrate] = useState(0);

  const index = Math.max(0, views.findIndex((q) => q.id === currentId));
  const view = views[index];
  const answered = views.filter((q) => q.answer).length;
  const total = dealing ?? views.length;
  // While dealing, every place in the paper: a dealt card, or a face-down one still coming.
  const places = dealing === null ? views : Array.from({ length: dealing }, (_, i) => views.find((q) => q.ordinal === i + 1) ?? i + 1);
  const moreComing = dealing !== null && index === views.length - 1;

  async function submit(response: string) {
    setPending(view.id);
    setError(null);
    const result = await postJson<{ question: QuestionView }>(
      "/api/grade",
      { examId, questionId: view.id, response },
    );
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The card keeps the number it shows; the next list from the server settles numbering.
    const graded = { ...result.data.question, ordinal: view.ordinal };
    setViews((current) => current.map((q) => (q.id === graded.id ? graded : q)));
    setAnnouncement(`Question ${graded.ordinal}: ${announce(graded)}`);
    setMotion({ id: graded.id, kind: "flip" });
    if (graded.answer?.isCorrect) {
      setCelebrate((n) => n + 1);
      playWin();
    }
  }

  function go(to: number) {
    setCurrentId(views[to].id);
    setError(null);
    setMotion({ id: views[to].id, kind: "deal" });
  }

  const tone = view.answer ? verdictTone(view) : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Questions" className="space-y-2">
        <ol className="flex flex-wrap justify-center gap-2">
          {places.map((q) => {
            if (typeof q === "number") {
              return (
                <li key={`coming-${q}`}>
                  <span
                    aria-label={`Question ${q}, still being dealt`}
                    role="img"
                    className="card-back grid h-14 w-10 animate-pulse place-items-center rounded-md opacity-60 shadow-md motion-reduce:animate-none"
                  />
                </li>
              );
            }
            const i = views.indexOf(q);
            const state = questionState(q);
            const face =
              state === "unanswered" ? "card-back text-felt-deep" : state === "correct" ? "bg-gold text-felt-deep border-2 border-chip-cream" : "bg-chip-grey text-cream border-2 border-chip-cream/60";
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={`Question ${q.ordinal}, ${q.answer ? verdictText(q) : "not answered"}`}
                  className={`grid h-14 w-10 place-items-center rounded-md text-sm font-bold shadow-md transition-transform tabular ${face} ${i === index ? "-translate-y-1.5 ring-3 ring-gold-bright" : ""}`}
                >
                  <span className={state === "unanswered" ? "rounded-full bg-chip-cream px-1.5" : ""}>
                    {q.ordinal}
                    <span aria-hidden="true">{STATE_MARK[state]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-center text-sm text-dim tabular">
          {answered} of {views.length} answered
          {dealing !== null && ` · ${dealing - views.length} still being dealt`}
        </p>
      </nav>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="relative">
        <article
          key={view.id}
          aria-labelledby="question-heading"
          onAnimationEnd={() => setMotion(null)}
          className={`card-face space-y-5 p-5 sm:p-7 ${motion?.id === view.id ? (motion.kind === "flip" ? "animate-flip" : "animate-deal") : ""}`}
        >
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 id="question-heading" className="text-2xl font-bold text-card-ink">
                Question {view.ordinal}
                <span className="font-sans text-base font-medium text-card-ink-dim"> of {total}</span>
              </h2>
              <p className="text-sm text-card-ink-dim">{view.topicLabel}</p>
            </div>
            <span className="rounded-full border-2 border-chip-red px-3 py-1 text-sm font-bold text-chip-red tabular">
              {view.marks} mark{view.marks === 1 ? "" : "s"}
            </span>
          </header>

          <MathText text={view.prompt} className="block whitespace-pre-wrap text-lg leading-relaxed" />

          {view.type === "mcq" && view.options && (
            <ul className="space-y-2" aria-label="Options">
              {view.options.map((option, i) => {
                const answeredHere = view.answer !== null;
                const chosen = view.answer?.response === String(i);
                const correct = view.reveal?.correctOption === i;
                const look = !answeredHere
                  ? "border-felt-deep/25 hover:border-gold hover:bg-gold/10"
                  : correct
                    ? "border-gold bg-gold/35 shadow-[0_0_0_2px_var(--gold),0_0_18px_rgb(212_175_55/0.45)]"
                    : chosen
                      ? "border-chip-grey/40 bg-chip-grey/15 text-card-ink-dim"
                      : "border-felt-deep/15 text-card-ink-dim";
                return (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={answeredHere || pending !== null}
                      onClick={() => void submit(String(i))}
                      className={`flex w-full items-center gap-3 rounded-full border-2 px-3 py-2 text-left transition-colors disabled:cursor-default ${look}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${correct && answeredHere ? "bg-gold text-felt-deep" : chosen ? "bg-chip-grey text-cream" : "bg-felt-deep text-cream"}`}
                      >
                        {OPTION_LETTERS[i]}
                      </span>
                      <span className="min-w-0">
                        <span className="sr-only">Option {OPTION_LETTERS[i]}: </span>
                        <MathText text={option} />
                        {answeredHere && correct && <span className="ml-2 text-sm font-bold">· Correct answer</span>}
                        {chosen && <span className="ml-2 text-sm font-bold">· Your answer</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!view.answer && view.type !== "mcq" && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(drafts[view.id] ?? "");
              }}
            >
              <label htmlFor={`answer-${view.id}`} className="block text-sm font-bold text-card-ink">
                Your answer{view.type === "numerical" && view.unit ? ` (in ${view.unit})` : ""}
              </label>
              {view.type === "short" ? (
                <textarea
                  id={`answer-${view.id}`}
                  rows={6}
                  value={drafts[view.id] ?? ""}
                  onChange={(e) => setDrafts({ ...drafts, [view.id]: e.target.value })}
                  className="w-full rounded-xl border-2 border-felt-deep/30 bg-white p-3 text-card-ink"
                />
              ) : (
                <input
                  id={`answer-${view.id}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={drafts[view.id] ?? ""}
                  onChange={(e) => setDrafts({ ...drafts, [view.id]: e.target.value })}
                  className="w-56 rounded-full border-2 border-felt-deep/30 bg-white px-4 py-2 text-card-ink tabular"
                />
              )}
              <button type="submit" disabled={pending !== null} className="btn-gold">
                {pending === view.id ? (view.type === "short" ? "Marking…" : "Checking…") : "Submit answer"}
              </button>
            </form>
          )}

          {pending === view.id && view.type === "mcq" && <p className="text-card-ink-dim">Checking…</p>}
          {error && (
            <p role="alert" className="rounded-xl bg-chip-red p-3 text-cream">
              {error}
            </p>
          )}

          {view.answer && tone && (
            <p className={`rounded-xl px-4 py-3 text-lg font-bold ${BANNER[tone]}`}>
              <span aria-hidden="true">{view.answer.isCorrect ? "✓ " : "✗ "}</span>
              {verdictText(view)}
            </p>
          )}
        </article>
        {celebrate > 0 && <ChipCascade key={celebrate} count={16} mode="burst" />}
      </div>

      {view.answer && (
        <section aria-label="Explanation" className="panel p-5 sm:p-6">
          <QuestionReveal view={view} />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={index === 0} onClick={() => go(index - 1)} className="btn-quiet">
          ← Previous
        </button>
        <button type="button" disabled={index === views.length - 1} onClick={() => go(index + 1)} className="btn-quiet">
          Next →
        </button>
        {moreComing && <span className="text-sm text-dim">The next card is still being dealt.</span>}
        {dealing === null ? (
          <Link href={`/exam/${examId}/results`} className={answered === views.length ? "btn-gold ml-auto no-underline" : "ml-auto"}>
            {answered === views.length ? "See the payout" : `See results (${views.length - answered} unanswered)`}
          </Link>
        ) : (
          <span className="ml-auto text-sm text-dim">Results open once every card is dealt.</span>
        )}
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
