import { NextResponse } from "next/server";
import { requestTopup } from "@/lib/generation/exams";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, examIdParam } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

/** Adds a batch replacing dropped questions, if any were dropped and the top-up limit allows. */
export async function POST(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const user = await requireApiUser();
    const examId = await examIdParam(params);
    await requireOwnedExam(user.id, examId);
    return NextResponse.json(await requestTopup(examId));
  } catch (error) {
    return errorResponse(error);
  }
}
