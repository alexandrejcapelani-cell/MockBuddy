import { NextResponse } from "next/server";
import { z } from "zod";
import { requestDeadline, warnIfOverServerlessLimit } from "@/lib/ai/config";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, parseBody } from "@/lib/http";
import { createMaterial, getOwnedMaterial, processMaterial } from "@/lib/ingest/ingest";
import { requireOwnedSubject } from "@/lib/ownership";

// A literal, because Next.js reads it statically; keep it equal to REQUEST_LIMIT_SECONDS.
export const maxDuration = 300;

const Body = z.union([
  // A file that was just uploaded.
  z.object({ subjectId: z.uuid(), storagePath: z.string().min(1), filename: z.string().trim().min(1).max(255) }),
  // Retry a material that failed.
  z.object({ materialId: z.uuid() }),
]);

/** Extracts, chunks and topic-labels one material file. */
export async function POST(request: Request) {
  const startedAt = Date.now();
  let materialId: string | undefined;
  try {
    const user = await requireApiUser();
    const body = await parseBody(request, Body);
    let material;
    if ("materialId" in body) {
      material = await getOwnedMaterial(user.id, body.materialId);
    } else {
      await requireOwnedSubject(user.id, body.subjectId);
      material = await createMaterial(user.id, body.subjectId, body.storagePath, body.filename);
    }
    materialId = material.id;

    const result = await processMaterial(material, requestDeadline(startedAt));
    return NextResponse.json({ material: result.material, calls: result.calls });
  } catch (error) {
    return errorResponse(error, materialId ? { materialId } : {});
  } finally {
    warnIfOverServerlessLimit("materials/ingest", startedAt, { materialId });
  }
}
