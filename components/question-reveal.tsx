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

export function formatMarks(marks: number): string {
  return Number.isInteger(marks) ? String(marks) : marks.toFixed(1);
}

/**
 * Everything shown once a question is answered (spec section 9): for multiple choice,
 * why each option is right or wrong; for written answers, the marks per rubric point; then
 * the reasoning, the worked solution and where in the material it comes from.
 */
export function QuestionReveal({ view }: { view: QuestionView }) {
  const { reveal, answer } = view;
  if (!reveal || !answer) return null;

  return (
    <div className="space-y-4">
      {view.type === "mcq" && view.options && (
        <ul className="space-y-2" aria-label="Every option explained">
          {view.options.map((option, index) => {
            const chosen = answer.response === String(index);
            const correct = index === reveal.correctOption;
            const explanation = reveal.optionExplanations?.find((e) => e.index === index)?.explanation;
            return (
              <li
                key={index}
                className={`rounded border p-2 ${correct ? "border-2 border-foreground" : ""} ${chosen && !correct ? "opacity-70" : ""}`}
              >
                <p>
                  <span className="font-medium">{OPTION_LETTERS[index]}.</span> <MathText text={option} />
                  {correct && <strong> · Correct answer</strong>}
                  {chosen && <strong> · Your answer</strong>}
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

      {view.type === "short" && (
        <div className="space-y-3">
          <div>
            <p className="font-medium">Your answer</p>
            <p className="whitespace-pre-wrap rounded border p-2">{answer.response || "(no answer)"}</p>
          </div>
          {answer.rubricMarks && (
            <div>
              <p className="font-medium">Marks by point</p>
              <ul className="space-y-1">
                {answer.rubricMarks.map((mark, i) => (
                  <li key={i}>
                    <span className="tabular-nums">
                      {formatMarks(mark.awarded)}/{formatMarks(mark.marks)}
                    </span>{" "}
                    · <MathText text={mark.point} />
                    <span className="block text-muted-foreground">{mark.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {answer.feedback && <p>{answer.feedback}</p>}
          {reveal.expectedAnswer && (
            <div>
              <p className="font-medium">Model answer</p>
              <MathText text={reveal.expectedAnswer} className="block whitespace-pre-wrap" />
            </div>
          )}
        </div>
      )}

      {view.type === "numerical" && (
        <div className="space-y-1">
          <p>
            <span className="font-medium">Your answer:</span> {answer.response || "(no answer)"}
          </p>
          <p>
            <span className="font-medium">Correct answer:</span> {reveal.numericAnswer}
            {view.unit && ` ${view.unit}`} (accepted within ±{reveal.tolerance})
          </p>
          {answer.feedback && <p>{answer.feedback}</p>}
        </div>
      )}

      <div className="space-y-1">
        <p className="font-medium">Why</p>
        <MathText text={reveal.correctExplanation} className="block whitespace-pre-wrap" />
      </div>
      <details>
        <summary className="cursor-pointer font-medium">Worked solution</summary>
        <MathText text={reveal.workedSolution} className="mt-1 block whitespace-pre-wrap" />
      </details>
      <p className="text-sm text-muted-foreground">
        From your material{reveal.sourceSection ? ` (${reveal.sourceSection})` : ""}: “{reveal.sourceExcerpt}”
      </p>
    </div>
  );
}
