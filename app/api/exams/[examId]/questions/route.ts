import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { loadExamForTaking } from "@/lib/exam/taking";
import { errorResponse, examIdParam } from "@/lib/http";
import { requireOwnedExam } from "@/lib/ownership";

/**
 * The exam's questions as the exam page may see them (no answer key until answered). The
 * page reads it each time a batch is saved, so questions appear while later ones generate.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const user = await requireApiUser();
    const examId = await examIdParam(params);
    await requireOwnedExam(user.id, examId);
    const { exam, questions } = await loadExamForTaking(examId);
    return NextResponse.json({ status: exam.status, questions });
  } catch (error) {
    return errorResponse(error);
  }
}
