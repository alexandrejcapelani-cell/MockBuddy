import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { chunks, materials } from "@/lib/db/schema";
import { classifyUpload, MAX_CHUNKS, MAX_UPLOAD_BYTES, storagePathFor } from "@/lib/files";
import { errorResponse, parseBody, RequestError } from "@/lib/http";
import { requireOwnedSubject } from "@/lib/ownership";
import { storage } from "@/lib/storage";

const Body = z.object({
  subjectId: z.uuid(),
  kind: z.enum(["material", "sample"]),
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative(),
});

/** Issues an upload target in the user's storage folder. The file bytes go straight to storage, never through this route. */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { subjectId, kind, filename, size } = await parseBody(request, Body);
    await requireOwnedSubject(user.id, subjectId);
    const check = classifyUpload(filename);
    if (!check.ok) throw new RequestError(check.message, 415);
    if (size === 0) throw new RequestError(`${filename} is empty.`);
    if (size > MAX_UPLOAD_BYTES) {
      throw new RequestError(`${filename} is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`, 413);
    }

    if (kind === "material") {
      const [{ total }] = await db()
        .select({ total: count() })
        .from(chunks)
        .innerJoin(materials, eq(chunks.materialId, materials.id))
        .where(eq(materials.subjectId, subjectId));
      if (total >= MAX_CHUNKS) {
        throw new RequestError(`This subject has reached the ${MAX_CHUNKS}-chunk limit. Remove a file before adding more.`, 409);
      }
    }

    const storagePath = storagePathFor(user.id, kind, randomUUID(), filename);
    const upload = await storage.createUploadTarget(storagePath, { contentType: check.contentType, maxBytes: MAX_UPLOAD_BYTES });
    return NextResponse.json({ storagePath, upload });
  } catch (error) {
    return errorResponse(error);
  }
}
