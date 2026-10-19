import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { BatchBusyError, runNextStage } from "@/lib/generation/stages";
import { errorResponse, parseBody, requestApiKey } from "@/lib/http";

export const maxDuration = 60;

const Body = z.object({ examId: z.uuid(), batchIndex: z.number().int().nonnegative() });

/**
 * Runs the next stage (draft, retry, critique or revise) of one batch of 5 questions.
 * The client calls it repeatedly until the batch is done; each call is one model call.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  let context: Record<string, unknown> = {};
  try {
    const apiKey = requestApiKey(request);
    const { examId, batchIndex } = await parseBody(request, Body);
    context = { examId, batchIndex };
    const batch = await runNextStage(examId, batchIndex, requestDeadline(startedAt), apiKey);
    return NextResponse.json({ batch, requestMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof BatchBusyError) return NextResponse.json({ busy: true, batch: error.batch }, { status: 409 });
    return errorResponse(error, context);
  } finally {
    warnIfOverServerlessLimit("generate", startedAt, context);
  }
}
