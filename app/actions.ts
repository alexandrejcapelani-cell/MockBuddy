"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { materials } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { storage } from "@/lib/storage";

/** Removes a material file, its chunks, and the questions generated from them. */
export async function removeMaterial(materialId: string): Promise<{ error: string | null }> {
  const userId = serverEnv("DEMO_USER_ID");
  const [removed] = await db()
    .delete(materials)
    .where(and(eq(materials.id, materialId), eq(materials.userId, userId)))
    .returning({ storagePath: materials.storagePath });
  revalidatePath("/");
  if (!removed) return { error: "That file was already removed." };
  await storage.remove(removed.storagePath);
  return { error: null };
}
