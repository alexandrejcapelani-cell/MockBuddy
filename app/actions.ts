"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { describeDbError } from "@/lib/db/errors";
import { pings } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";

export type PingState = { status: "idle" } | { status: "ok"; id: string } | { status: "error"; message: string };

const NoteSchema = z
  .string("Write something to store.")
  .trim()
  .min(1, "Write something to store.")
  .max(200, "Keep it under 200 characters.");

export async function createPing(_previous: PingState, formData: FormData): Promise<PingState> {
  const note = NoteSchema.safeParse(formData.get("note"));
  if (!note.success) return { status: "error", message: note.error.issues[0].message };

  try {
    const [row] = await db()
      .insert(pings)
      .values({ userId: serverEnv("DEMO_USER_ID"), note: note.data })
      .returning({ id: pings.id });
    revalidatePath("/");
    return { status: "ok", id: row.id };
  } catch (error) {
    console.error("createPing failed", error);
    return { status: "error", message: describeDbError(error) };
  }
}
