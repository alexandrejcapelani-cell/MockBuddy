import { NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { createExam, QUESTION_COUNTS } from "@/lib/generation/exams";
import { errorResponse, parseBody } from "@/lib/http";

const Body = z.object({
  questionCount: z.literal(QUESTION_COUNTS),
  difficulty: z.enum(["easier", "same", "harder"]),
});

/** Creates an exam: its slot plan (types, sections, chunks) and its batches, ready to generate. */
export async function POST(request: Request) {
  try {
    const { questionCount, difficulty } = await parseBody(request, Body);
    const result = await createExam({ userId: serverEnv("DEMO_USER_ID"), questionCount, difficulty });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
