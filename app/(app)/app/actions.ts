"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { materials } from "@/lib/db/schema";
import { storage } from "@/lib/storage";
import { addSubject, cleanSubjectName } from "@/lib/subjects";

export interface SubjectFormState {
  error: string | null;
}

/**
 * The main feature's save (core-input → core-submit): adds a subject and opens it. Only a
 * database write, so it never depends on uploads or the AI service.
 */
export async function createSubject(_previous: SubjectFormState, form: FormData): Promise<SubjectFormState> {
  const user = await requireUser();
  const name = cleanSubjectName(String(form.get("name") ?? ""));
  if (!name.ok) return { error: name.message };
  const subjectId = await addSubject(user.id, name.name);
  revalidatePath("/app");
  redirect(`/app?subject=${subjectId}`);
}

/** Removes a material file, its chunks, and the questions generated from them. */
export async function removeMaterial(materialId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const [removed] = await db()
    .delete(materials)
    .where(and(eq(materials.id, materialId), eq(materials.userId, user.id)))
    .returning({ storagePath: materials.storagePath });
  revalidatePath("/app");
  if (!removed) return { error: "That file was already removed." };
  await storage.remove(removed.storagePath);
  return { error: null };
}
