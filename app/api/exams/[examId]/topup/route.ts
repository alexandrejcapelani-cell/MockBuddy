import { NextResponse } from "next/server";
import { requestTopup } from "@/lib/generation/exams";
import { errorResponse, examIdParam } from "@/lib/http";

/** Adds a batch replacing dropped questions, if any were dropped and the top-up limit allows. */
export async function POST(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  try {
    const examId = await examIdParam(params);
    return NextResponse.json(await requestTopup(examId));
  } catch (error) {
    return errorResponse(error);
  }
}
