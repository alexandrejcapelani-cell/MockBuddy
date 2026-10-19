import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { subjects } from "@/lib/db/schema";

export { cleanSubjectName, MAX_SUBJECT_NAME } from "./subject-name";

// Subjects are the main thing a user saves (the grading contract's core item): a name such
// as "Econometrics". Material, the sample exam, mocks and history all belong to one.
// Creating one never touches files or the model, so it can't fail for those reasons.

export async function listSubjects(userId: string) {
  return db()
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.userId, userId))
    .orderBy(desc(subjects.createdAt));
}

/** Adds the subject, or returns the existing one with the same name (ignoring case). */
export async function addSubject(userId: string, name: string): Promise<string> {
  const [created] = await db().insert(subjects).values({ userId, name }).onConflictDoNothing().returning({ id: subjects.id });
  if (created) return created.id;
  const [existing] = await db()
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), sql`lower(${subjects.name}) = lower(${name})`));
  if (!existing) throw new Error("Saving the subject conflicted with a row that can't be found.");
  return existing.id;
}
