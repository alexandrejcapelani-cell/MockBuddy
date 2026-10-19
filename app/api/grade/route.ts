import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { submitAnswer } from "@/lib/exam/taking";
import { errorResponse, parseBody, requestApiKey } from "@/lib/http";

export const maxDuration = 60;

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
    const apiKey = requestApiKey(request);
    const { examId, questionId, response } = await parseBody(request, Body);
    context = { examId, questionId };
    const result = await submitAnswer({ examId, questionId, response, apiKey, deadlineAt: requestDeadline(startedAt) });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, context);
  } finally {
    warnIfOverServerlessLimit("grade", startedAt, context);
  }
}
