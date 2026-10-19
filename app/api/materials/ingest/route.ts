import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { serverEnv } from "@/lib/env";
import { errorResponse, parseBody, requestApiKey } from "@/lib/http";
import { createMaterial, getOwnedMaterial, processMaterial } from "@/lib/ingest/ingest";

export const maxDuration = 60;

const Body = z.union([
  // A file that was just uploaded.
  z.object({ storagePath: z.string().min(1), filename: z.string().trim().min(1).max(255) }),
  // Retry a material that failed.
  z.object({ materialId: z.uuid() }),
]);

/** Extracts, chunks and topic-labels one material file. */
export async function POST(request: Request) {
  const startedAt = Date.now();
  let materialId: string | undefined;
  try {
    const apiKey = requestApiKey(request);
    const body = await parseBody(request, Body);
    const userId = serverEnv("DEMO_USER_ID");
    const material =
      "materialId" in body
        ? await getOwnedMaterial(userId, body.materialId)
        : await createMaterial(userId, body.storagePath, body.filename);
    materialId = material.id;

    const result = await processMaterial(material, requestDeadline(startedAt), apiKey);
    return NextResponse.json({ material: result.material, calls: result.calls });
  } catch (error) {
    return errorResponse(error, materialId ? { materialId } : {});
  } finally {
    warnIfOverServerlessLimit("materials/ingest", startedAt, { materialId });
  }
}
