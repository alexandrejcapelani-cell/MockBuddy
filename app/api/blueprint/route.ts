import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { requireApiUser } from "@/lib/auth";
import { createBlueprint } from "@/lib/blueprint/extract-blueprint";
import { errorResponse, parseBody } from "@/lib/http";
import { requireOwnedSubject } from "@/lib/ownership";

// A literal, because Next.js reads it statically; keep it equal to REQUEST_LIMIT_SECONDS.
export const maxDuration = 300;

const Body = z.object({ subjectId: z.uuid(), storagePath: z.string().min(1), filename: z.string().trim().min(1).max(255) });

/** Builds the blueprint and verbatim sample questions from an uploaded sample exam. */
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const user = await requireApiUser();
    const { subjectId, storagePath, filename } = await parseBody(request, Body);
    await requireOwnedSubject(user.id, subjectId);
    const result = await createBlueprint(user.id, subjectId, storagePath, filename, requestDeadline(startedAt));
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  } finally {
    warnIfOverServerlessLimit("blueprint", startedAt);
  }
}
