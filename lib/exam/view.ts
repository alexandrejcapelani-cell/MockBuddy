import type { answers, questions } from "../db/schema.ts";
import type { RubricMark } from "../grading/types.ts";
import type { OptionExplanation, QuestionType, RubricPoint } from "../schemas.ts";

// What the exam page is allowed to know about a question. The answer key and every
// explanation stay on the server until the question has been answered, so they can't be
// read from the page before answering.

type QuestionRow = typeof questions.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;

export interface Reveal {
  correctOption: number | null;
  optionExplanations: OptionExplanation[] | null;
  correctExplanation: string;
  expectedAnswer: string | null;
  rubric: RubricPoint[] | null;
  numericAnswer: number | null;
  tolerance: number | null;
  workedSolution: string;
  sourceExcerpt: string;
  sourceSection: string | null;
}

export interface AnswerView {
  response: string;
  isCorrect: boolean;
  awardedMarks: number;
  feedback: string | null;
  rubricMarks: RubricMark[] | null;
}

export interface QuestionView {
  id: string;
  ordinal: number;
  type: QuestionType;
  prompt: string;
  marks: number;
  topicLabel: string;
  options: string[] | null;
  unit: string | null;
  answer: AnswerView | null;
  /** Null until the question is answered. */
  reveal: Reveal | null;
}

export function toQuestionView(question: QuestionRow, answer: AnswerRow | null, sourceSection: string | null): QuestionView {
  return {
    id: question.id,
    ordinal: question.ordinal,
    type: question.type,
    prompt: question.prompt,
    marks: question.marks,
    topicLabel: question.topicLabel,
    options: question.options,
    unit: question.unit,
    answer: answer
      ? {
          response: answer.response,
          isCorrect: answer.isCorrect,
          awardedMarks: answer.awardedMarks,
          feedback: answer.feedback,
          rubricMarks: answer.rubricMarks,
        }
      : null,
    reveal: answer
      ? {
          correctOption: question.correctOption,
          optionExplanations: question.optionExplanations,
          correctExplanation: question.correctExplanation,
          expectedAnswer: question.expectedAnswer,
          rubric: question.rubric,
          numericAnswer: question.numericAnswer,
          tolerance: question.tolerance,
          workedSolution: question.workedSolution,
          sourceExcerpt: question.sourceExcerpt,
          sourceSection,
        }
      : null,
  };
}

export type QuestionState = "unanswered" | "correct" | "wrong";

export function questionState(view: QuestionView): QuestionState {
  if (!view.answer) return "unanswered";
  return view.answer.isCorrect ? "correct" : "wrong";
}
