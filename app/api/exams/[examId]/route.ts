import { NextResponse } from "next/server";
import { examProgress } from "@/lib/generation/context";
import { errorResponse, examIdParam } from "@/lib/http";

/** Generation progress: every batch's stage, outcomes and timings. */
export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const examId = await examIdParam(params);
    return NextResponse.json(await examProgress(examId));
  } catch (error) {
    return errorResponse(error);
  }
}
