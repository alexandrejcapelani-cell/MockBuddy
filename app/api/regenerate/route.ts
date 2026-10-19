import { NextResponse } from "next/server";
import { z } from "zod";
import { regenerateExam } from "@/lib/generation/exams";
import { errorResponse, parseBody } from "@/lib/http";

const Body = z.object({ examId: z.uuid() });

/**
 * REGENERATE: creates a fresh exam from the same material, sample exam, count and
 * difficulty, with a new seed and the previous exams' stems excluded. Generation itself
 * then runs from the generation page, like any new mock.
 */
export async function POST(request: Request) {
  try {
    const { examId } = await parseBody(request, Body);
    return NextResponse.json(await regenerateExam(examId), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
