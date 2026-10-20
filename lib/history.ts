import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, exams, questions, subjects } from "@/lib/db/schema";
import { computeResults } from "@/lib/exam/results";
import { toQuestionView } from "@/lib/exam/view";

// The history page: every past mock, newest first, with its score once taken.

export interface HistoryRow {
  examId: string;
  subject: string;
  createdAt: Date;
  questionCount: number;
  generated: number;
  difficulty: (typeof exams.$inferSelect)["difficulty"];
  status: (typeof exams.$inferSelect)["status"];
  answered: number;
  /** Percent of the exam's marks; null until at least one question is answered. */
  score: number | null;
  /** The COLD topic(s); empty when nothing is answered or there's no spread between topics. */
  weakest: string[];
}

export async function listHistory(userId: string): Promise<HistoryRow[]> {
  const rows = await db()
    .select({
      id: exams.id,
      createdAt: exams.createdAt,
      questionCount: exams.questionCount,
      difficulty: exams.difficulty,
      status: exams.status,
      subject: subjects.name,
    })
    .from(exams)
    .innerJoin(subjects, eq(exams.subjectId, subjects.id))
    .where(eq(exams.userId, userId))
    .orderBy(desc(exams.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [allQuestions, allAnswers] = await Promise.all([
    db().select().from(questions).where(inArray(questions.examId, ids)),
    db().select().from(answers).where(inArray(answers.examId, ids)),
  ]);
  const answerOf = new Map(allAnswers.map((answer) => [answer.questionId, answer]));

  return rows.map((row) => {
    const views = allQuestions
      .filter((question) => question.examId === row.id)
      .map((question) => toQuestionView(question, answerOf.get(question.id) ?? null, null));
    const results = computeResults(views);
    return {
      examId: row.id,
      subject: row.subject,
      createdAt: row.createdAt,
      questionCount: row.questionCount,
      generated: views.length,
      difficulty: row.difficulty,
      status: row.status,
      answered: results.answered,
      score: results.answered > 0 ? results.percent : null,
      weakest: results.topics.filter((topic) => topic.flag === "COLD").map((topic) => topic.topic),
    };
  });
}
