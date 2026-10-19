import { MathText } from "@/components/math-text";
import type { QuestionView } from "@/lib/exam/view";

export const OPTION_LETTERS = "ABCDEFGH";

/** The verdict in words, so it never depends on colour alone. */
export function verdictText(view: QuestionView): string {
  if (!view.answer) return "Not answered";
  const { awardedMarks, isCorrect } = view.answer;
  const marks = `${formatMarks(awardedMarks)} of ${formatMarks(view.marks)} mark${view.marks === 1 ? "" : "s"}`;
  if (awardedMarks >= view.marks) return `Correct: ${marks}`;
  if (awardedMarks > 0) return `${isCorrect ? "Mostly right" : "Partly right"}: ${marks}`;
  return `Wrong: ${marks}`;
}

export type VerdictTone = "correct" | "partial" | "wrong";

export function verdictTone(view: QuestionView): VerdictTone {
  if (!view.answer) return "wrong";
  if (view.answer.awardedMarks >= view.marks) return "correct";
  return view.answer.awardedMarks > 0 ? "partial" : "wrong";
}

export function formatMarks(marks: number): string {
  return Number.isInteger(marks) ? String(marks) : marks.toFixed(1);
}

/**
 * The explanation block shown once a question is answered (spec section 9), on the felt:
 * for multiple choice, why each option is right or wrong; for written answers, the marks
 * per rubric point; then the reasoning, the worked solution and its source in the material.
 */
export function QuestionReveal({ view }: { view: QuestionView }) {
  const { reveal, answer } = view;
  if (!reveal || !answer) return null;

  return (
    <div className="space-y-5">
      {view.type === "mcq" && view.options && (
        <div className="space-y-2">
          <h3 className="font-sans text-sm font-bold tracking-[0.16em] text-gold-text uppercase">Every option, explained</h3>
          <ul className="space-y-2">
            {view.options.map((option, index) => {
              const chosen = answer.response === String(index);
              const correct = index === reveal.correctOption;
              const explanation = reveal.optionExplanations?.find((e) => e.index === index)?.explanation;
              return (
                <li
                  key={index}
                  className={`flex gap-3 rounded-xl border p-3 ${correct ? "border-gold bg-gold/10" : chosen ? "border-border bg-chip-grey" : "border-border/60"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${correct ? "bg-gold text-felt-deep" : "bg-chip-cream/90 text-felt-deep"}`}
                  >
                    {OPTION_LETTERS[index]}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-dim">
                      <span className="sr-only">Option {OPTION_LETTERS[index]}: </span>
                      <MathText text={option} />
                      {correct && <strong className="ml-2 text-gold-text">Correct answer</strong>}
                      {chosen && <strong className="ml-2 text-cream">Your answer</strong>}
                    </p>
                    {explanation && <MathText text={explanation} className="block whitespace-pre-wrap text-cream" />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {view.type === "short" && (
        <div className="space-y-3">
          <div>
            <h3 className="font-sans text-sm font-bold tracking-[0.16em] text-gold-text uppercase">Your answer</h3>
            <p className="mt-1 whitespace-pre-wrap rounded-xl bg-felt-deep p-3">{answer.response || "(no answer)"}</p>
          </div>
          {answer.rubricMarks && (
            <div>
              <h3 className="font-sans text-sm font-bold tracking-[0.16em] text-gold-text uppercase">Marks by point</h3>
              <ul className="mt-1 space-y-2">
                {answer.rubricMarks.map((mark, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      className={`grid h-9 min-w-12 shrink-0 place-items-center rounded-full px-2 text-sm font-bold tabular ${mark.awarded >= mark.marks ? "bg-gold text-felt-deep" : mark.awarded > 0 ? "bg-wood text-cream" : "bg-chip-red text-cream"}`}
                    >
                      {formatMarks(mark.awarded)}/{formatMarks(mark.marks)}
                    </span>
                    <span>
                      <MathText text={mark.point} />
                      <span className="block text-dim">{mark.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {answer.feedback && <p>{answer.feedback}</p>}
          {reveal.expectedAnswer && (
            <div>
              <h3 className="font-sans text-sm font-bold tracking-[0.16em] text-gold-text uppercase">Model answer</h3>
              <MathText text={reveal.expectedAnswer} className="mt-1 block whitespace-pre-wrap" />
            </div>
          )}
        </div>
      )}

      {view.type === "numerical" && (
        <div className="space-y-1">
          <p>
            <span className="font-semibold text-gold-text">Your answer:</span> {answer.response || "(no answer)"}
          </p>
          <p>
            <span className="font-semibold text-gold-text">Correct answer:</span> <span className="tabular">{reveal.numericAnswer}</span>
            {view.unit && ` ${view.unit}`} <span className="text-dim">(accepted within ±{reveal.tolerance})</span>
          </p>
          {answer.feedback && <p>{answer.feedback}</p>}
        </div>
      )}

      <div className="space-y-1">
        <h3 className="font-sans text-sm font-bold tracking-[0.16em] text-gold-text uppercase">Why</h3>
        <MathText text={reveal.correctExplanation} className="block whitespace-pre-wrap" />
      </div>
      <details className="rounded-xl border border-border/60 p-3">
        <summary className="cursor-pointer font-semibold">Worked solution</summary>
        <MathText text={reveal.workedSolution} className="mt-2 block whitespace-pre-wrap" />
      </details>
      <p className="text-sm text-dim">
        From your material{reveal.sourceSection ? ` (${reveal.sourceSection})` : ""}: “{reveal.sourceExcerpt}”
      </p>
    </div>
  );
}
