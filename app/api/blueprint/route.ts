import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { createBlueprint } from "@/lib/blueprint/extract-blueprint";
import { serverEnv } from "@/lib/env";
import { errorResponse, parseBody, requestApiKey } from "@/lib/http";

export const maxDuration = 60;

const Body = z.object({ storagePath: z.string().min(1), filename: z.string().trim().min(1).max(255) });

/** Builds the blueprint and verbatim sample questions from an uploaded sample exam. */
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const apiKey = requestApiKey(request);
    const { storagePath, filename } = await parseBody(request, Body);
    const result = await createBlueprint(serverEnv("DEMO_USER_ID"), storagePath, filename, requestDeadline(startedAt), apiKey);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  } finally {
    warnIfOverServerlessLimit("blueprint", startedAt);
  }
}
