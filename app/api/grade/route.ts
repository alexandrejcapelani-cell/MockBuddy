import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { requireApiUser } from "@/lib/auth";
import { submitAnswer } from "@/lib/exam/taking";
import { errorResponse, parseBody } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

// A literal, because Next.js reads it statically; keep it equal to REQUEST_LIMIT_SECONDS.
export const maxDuration = 300;

const Body = z.object({
  examId: z.uuid(),
  questionId: z.uuid(),
  response: z.string(),
});

/**
 * Marks one answer and returns the question with its verdict and explanations. MCQ and
 * readable numbers are marked without the model; short answers (and numbers the parser
 * can't read) take one model call.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  let context: Record<string, unknown> = {};
  try {
    const user = await requireApiUser();
    const { examId, questionId, response } = await parseBody(request, Body);
    context = { examId, questionId };
    await requireOwnedExam(user.id, examId);
    const result = await submitAnswer({ examId, questionId, response, deadlineAt: requestDeadline(startedAt) });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, context);
  } finally {
    warnIfOverServerlessLimit("grade", startedAt, context);
  }
}
