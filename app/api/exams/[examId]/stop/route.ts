import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { stopRun } from "@/lib/generation/exams";
import { errorResponse, examIdParam } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

/** Keep what's ready: ends a timed-out run with the questions that already passed. */
export async function POST(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const user = await requireApiUser();
    const examId = await examIdParam(params);
    await requireOwnedExam(user.id, examId);
    return NextResponse.json(await stopRun(examId));
  } catch (error) {
    return errorResponse(error);
  }
}
