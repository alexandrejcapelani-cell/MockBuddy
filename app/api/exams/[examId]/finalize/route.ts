import { NextResponse } from "next/server";
import { finalizeExam } from "@/lib/generation/exams";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, examIdParam } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

/** Numbers the questions in order and marks the exam ready, reporting any shortfall. */
export async function POST(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const user = await requireApiUser();
    const examId = await examIdParam(params);
    await requireOwnedExam(user.id, examId);
    return NextResponse.json(await finalizeExam(examId));
  } catch (error) {
    return errorResponse(error);
  }
}
