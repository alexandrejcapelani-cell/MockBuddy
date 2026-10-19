import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { requireApiUser } from "@/lib/auth";
import { BatchBusyError, runNextStage } from "@/lib/generation/stages";
import { errorResponse, parseBody } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

// A literal, because Next.js reads it statically; keep it equal to REQUEST_LIMIT_SECONDS.
export const maxDuration = 300;

const Body = z.object({ examId: z.uuid(), batchIndex: z.number().int().nonnegative() });

/**
 * Runs the next stage (draft, retry, critique or revise) of one batch of 5 questions.
 * The client calls it repeatedly until the batch is done; each call is one model call.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  let context: Record<string, unknown> = {};
  try {
    const user = await requireApiUser();
    const { examId, batchIndex } = await parseBody(request, Body);
    context = { examId, batchIndex };
    await requireOwnedExam(user.id, examId);
    const batch = await runNextStage(examId, batchIndex, requestDeadline(startedAt));
    return NextResponse.json({ batch, requestMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof BatchBusyError) return NextResponse.json({ busy: true, batch: error.batch }, { status: 409 });
    return errorResponse(error, context);
  } finally {
    warnIfOverServerlessLimit("generate", startedAt, context);
  }
}
