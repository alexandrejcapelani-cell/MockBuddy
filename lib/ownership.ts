import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { exams, subjects } from "@/lib/db/schema";
import { RequestError } from "@/lib/http";

// The server's database role isn't bound by RLS, so every lookup by id checks the row
// belongs to the signed-in user. Someone else's id answers exactly like a missing one.

export type Subject = typeof subjects.$inferSelect;

export async function ownedSubject(userId: string, subjectId: string): Promise<Subject | null> {
  const [subject] = await db()
    .select()
    .from(subjects)
    .where(and(eq(subjects.id, subjectId), eq(subjects.userId, userId)));
  return subject ?? null;
}

export async function requireOwnedSubject(userId: string, subjectId: string): Promise<Subject> {
  const subject = await ownedSubject(userId, subjectId);
  if (!subject) throw new RequestError("That subject doesn't exist.", 404);
  return subject;
}

export async function ownsExam(userId: string, examId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.id, examId), eq(exams.userId, userId)));
  return row !== undefined;
}

export async function requireOwnedExam(userId: string, examId: string): Promise<void> {
  if (!(await ownsExam(userId, examId))) throw new RequestError("That exam doesn't exist.", 404);
}
