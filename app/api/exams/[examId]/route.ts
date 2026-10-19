import { NextResponse } from "next/server";
import { examProgress } from "@/lib/generation/context";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, examIdParam } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

/** Generation progress: every batch's stage, outcomes and timings. */
export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const user = await requireApiUser();
    const examId = await examIdParam(params);
    await requireOwnedExam(user.id, examId);
    return NextResponse.json(await examProgress(examId));
  } catch (error) {
    return errorResponse(error);
  }
}
