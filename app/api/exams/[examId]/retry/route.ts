import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { examProgress } from "@/lib/generation/context";
import { restartRun } from "@/lib/generation/exams";
import { errorResponse, examIdParam } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

/** Retry after the time limit: a fresh run for the same mock, carrying on from where it stopped. */
export async function POST(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const user = await requireApiUser();
    const examId = await examIdParam(params);
    await requireOwnedExam(user.id, examId);
    await restartRun(examId);
    return NextResponse.json(await examProgress(examId));
  } catch (error) {
    return errorResponse(error);
  }
}
