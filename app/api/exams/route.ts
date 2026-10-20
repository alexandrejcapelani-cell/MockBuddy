import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { createExam, QUESTION_COUNTS } from "@/lib/generation/exams";
import { QUESTION_FORMATS } from "@/lib/generation/format";
import { errorResponse, parseBody } from "@/lib/http";
import { requireOwnedSubject } from "@/lib/ownership";

const Body = z.object({
  subjectId: z.uuid(),
  questionCount: z.literal(QUESTION_COUNTS),
  difficulty: z.enum(["easier", "same", "harder"]),
  format: z.enum(QUESTION_FORMATS).default("mixed"),
});

/** Creates an exam (its slot plan and batches, ready to generate), using one free mock. */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { subjectId, questionCount, difficulty, format } = await parseBody(request, Body);
    await requireOwnedSubject(user.id, subjectId);
    const result = await createExam({ userId: user.id, subjectId, questionCount, difficulty, format });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
