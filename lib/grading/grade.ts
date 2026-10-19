import "server-only";
import { type CallMetrics, generateValidatedJson, schemaText } from "@/lib/ai/call";
import type { ApiKey } from "@/lib/api-key";
import type { questions } from "@/lib/db/schema";
import { NumericJudgementSchema, ShortAnswerGradeSchema } from "@/lib/schemas";
import { NUMERIC_JUDGE_SYSTEM, numericJudgePrompt, SHORT_GRADING_SYSTEM, shortGradingPrompt } from "./prompts";
import { parseNumericResponse, shortGradeIssues, shortIsCorrect, totalAwarded, withinTolerance } from "./rules";
import type { RubricMark } from "./types";

// Stage D. MCQ and readable numbers are marked deterministically; short answers, and
// numbers the parser can't read, take one model call (plus one retry if the marking is
// malformed).

type Question = typeof questions.$inferSelect;

export interface Grade {
  isCorrect: boolean;
  awardedMarks: number;
  feedback: string | null;
  rubricMarks: RubricMark[] | null;
  calls: CallMetrics[];
}

export async function gradeAnswer(question: Question, response: string, apiKey: ApiKey, deadlineAt: number | undefined): Promise<Grade> {
  switch (question.type) {
    case "mcq":
      return gradeMcq(question, response);
    case "numerical":
      return gradeNumerical(question, response, apiKey, deadlineAt);
    case "short":
      return gradeShort(question, response, apiKey, deadlineAt);
  }
}

function gradeMcq(question: Question, response: string): Grade {
  const correct = Number(response) === question.correctOption;
  return { isCorrect: correct, awardedMarks: correct ? question.marks : 0, feedback: null, rubricMarks: null, calls: [] };
}

async function gradeNumerical(question: Question, response: string, apiKey: ApiKey, deadlineAt: number | undefined): Promise<Grade> {
  const answer = question.numericAnswer!;
  const tolerance = question.tolerance ?? 0;
  if (response.trim() === "") return unanswered();

  const readings = parseNumericResponse(response);
  if (readings) {
    const correct = readings.some((value) => withinTolerance(value, answer, tolerance));
    return {
      isCorrect: correct,
      awardedMarks: correct ? question.marks : 0,
      feedback: correct ? null : `You gave ${readings[0]}; the answer is ${answer}${question.unit ? ` ${question.unit}` : ""} (±${tolerance}).`,
      rubricMarks: null,
      calls: [],
    };
  }

  const { data, calls } = await generateValidatedJson(
    {
      context: { label: "grade_numeric", questionId: question.id },
      task: "grading",
      schema: NumericJudgementSchema,
      system: [{ type: "text", text: NUMERIC_JUDGE_SYSTEM }],
      messages: [
        {
          role: "user",
          content: numericJudgePrompt({
            prompt: question.prompt,
            answer,
            tolerance,
            unit: question.unit,
            response,
            schema: schemaText(NumericJudgementSchema),
          }),
        },
      ],
      deadlineAt,
      apiKey,
    },
    (judgement) => (judgement.feedback.trim() === "" ? ["feedback is empty."] : []),
  );
  return { isCorrect: data.is_correct, awardedMarks: data.is_correct ? question.marks : 0, feedback: data.feedback, rubricMarks: null, calls };
}

async function gradeShort(question: Question, response: string, apiKey: ApiKey, deadlineAt: number | undefined): Promise<Grade> {
  const rubric = question.rubric ?? [];
  if (response.trim() === "") return unanswered();

  const { data, calls } = await generateValidatedJson(
    {
      context: { label: "grade_short", questionId: question.id },
      task: "grading",
      schema: ShortAnswerGradeSchema,
      system: [{ type: "text", text: SHORT_GRADING_SYSTEM }],
      messages: [
        {
          role: "user",
          content: shortGradingPrompt({
            prompt: question.prompt,
            expectedAnswer: question.expectedAnswer ?? "",
            rubric,
            response,
            schema: schemaText(ShortAnswerGradeSchema),
          }),
        },
      ],
      deadlineAt,
      apiKey,
    },
    (grade) => shortGradeIssues(grade, rubric),
  );
  const awarded = Math.min(question.marks, totalAwarded(data));
  return {
    isCorrect: shortIsCorrect(awarded, question.marks),
    awardedMarks: awarded,
    feedback: data.feedback,
    rubricMarks: rubric.map((point, index) => {
      const entry = data.points.find((p) => p.index === index)!;
      return { point: point.point, marks: point.marks, awarded: entry.awarded, reason: entry.reason };
    }),
    calls,
  };
}

function unanswered(): Grade {
  return { isCorrect: false, awardedMarks: 0, feedback: "No answer given.", rubricMarks: null, calls: [] };
}
