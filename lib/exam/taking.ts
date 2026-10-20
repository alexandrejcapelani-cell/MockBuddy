import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { CallMetrics } from "@/lib/ai/call";
import { db } from "@/lib/db";
import { answers, chunks, exams, questions } from "@/lib/db/schema";
import { paperPositions } from "@/lib/generation/plan";
import { gradeAnswer } from "@/lib/grading/grade";
import { RequestError } from "@/lib/http";
import { type QuestionView, toQuestionView } from "./view";

// Taking the exam (screen 3) and storing answers. Questions can be answered as soon as their
// batch is saved, while later batches still generate.

export type ExamRow = typeof exams.$inferSelect;

const MAX_RESPONSE_CHARS = 5_000;

export interface ExamForTaking {
  exam: ExamRow;
  questions: QuestionView[];
}

/**
 * The number a question shows. While the mock generates, that's its paper position (a top-up
 * in the place of the question it replaces), the order finalizing will number them in.
 */
function displayOrdinal(exam: ExamRow): (ordinal: number) => number {
  if (exam.status !== "generating") return (ordinal) => ordinal;
  const positions = paperPositions(exam.plan.slots);
  return (ordinal) => positions.get(ordinal) ?? ordinal;
}

export async function loadExamForTaking(examId: string): Promise<ExamForTaking> {
  const [exam] = await db().select().from(exams).where(eq(exams.id, examId));
  if (!exam) throw new RequestError("That exam doesn't exist.", 404);
  const rows = await db().select().from(questions).where(eq(questions.examId, examId)).orderBy(asc(questions.ordinal));
  const numbered = displayOrdinal(exam);
  const given = await db().select().from(answers).where(eq(answers.examId, examId));
  const sections = rows.length
    ? await db()
        .select({ id: chunks.id, sectionLabel: chunks.sectionLabel })
        .from(chunks)
        .where(inArray(chunks.id, [...new Set(rows.map((q) => q.sourceChunkId))]))
    : [];
  const sectionOf = new Map(sections.map((s) => [s.id, s.sectionLabel]));
  const answerOf = new Map(given.map((a) => [a.questionId, a]));
  return {
    exam,
    questions: rows
      .map((q) => ({ ...toQuestionView(q, answerOf.get(q.id) ?? null, sectionOf.get(q.sourceChunkId) ?? null), ordinal: numbered(q.ordinal) }))
      .sort((a, b) => a.ordinal - b.ordinal),
  };
}

export interface SubmittedAnswer {
  question: QuestionView;
  answered: number;
  total: number;
  calls: CallMetrics[];
}

/**
 * Marks and stores one answer. Answering is final: a question that already has an answer
 * returns that answer unchanged, so a double click can't mark it twice.
 */
export async function submitAnswer(input: {
  examId: string;
  questionId: string;
  response: string;
  deadlineAt: number | undefined;
}): Promise<SubmittedAnswer> {
  const [exam] = await db().select().from(exams).where(eq(exams.id, input.examId));
  if (!exam) throw new RequestError("That exam doesn't exist.", 404);

  const [question] = await db()
    .select()
    .from(questions)
    .where(and(eq(questions.id, input.questionId), eq(questions.examId, input.examId)));
  if (!question) throw new RequestError("That question isn't part of this exam.", 404);

  let calls: CallMetrics[] = [];
  const [existing] = await db().select().from(answers).where(eq(answers.questionId, question.id));
  if (!existing) {
    const response = validResponse(question, input.response);
    const grade = await gradeAnswer(question, response, input.deadlineAt);
    calls = grade.calls;
    await db()
      .insert(answers)
      .values({
        examId: input.examId,
        questionId: question.id,
        response,
        isCorrect: grade.isCorrect,
        awardedMarks: grade.awardedMarks,
        feedback: grade.feedback,
        rubricMarks: grade.rubricMarks,
      })
      .onConflictDoNothing({ target: answers.questionId });
  }

  const [{ answered }] = await db().select({ answered: count() }).from(answers).where(eq(answers.examId, input.examId));
  const [{ total }] = await db().select({ total: count() }).from(questions).where(eq(questions.examId, input.examId));
  // Only a finished mock can be fully answered; while it generates, more questions are coming
  // (finalizing marks it graded if they were all answered by then). The condition is checked
  // again in the update, in case it finalized meanwhile.
  if (answered === total) {
    await db()
      .update(exams)
      .set({ status: "graded" })
      .where(and(eq(exams.id, input.examId), eq(exams.status, "ready")));
  }

  const [stored] = await db().select().from(answers).where(eq(answers.questionId, question.id));
  const [section] = await db().select({ label: chunks.sectionLabel }).from(chunks).where(eq(chunks.id, question.sourceChunkId));
  const view = toQuestionView(question, stored, section?.label ?? null);
  return { question: { ...view, ordinal: displayOrdinal(exam)(question.ordinal) }, answered, total, calls };
}

function validResponse(question: typeof questions.$inferSelect, response: string): string {
  if (response.length > MAX_RESPONSE_CHARS) throw new RequestError(`Answers are limited to ${MAX_RESPONSE_CHARS} characters.`);
  if (question.type === "mcq") {
    const index = Number(response);
    if (!Number.isInteger(index) || index < 0 || index >= (question.options?.length ?? 0)) {
      throw new RequestError("Choose one of the options.");
    }
    return String(index);
  }
  return response.trim();
}
