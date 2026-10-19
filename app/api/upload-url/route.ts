import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { chunks, materials } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { classifyUpload, MAX_CHUNKS, MAX_UPLOAD_BYTES, storagePathFor } from "@/lib/files";
import { errorResponse, parseBody, RequestError } from "@/lib/http";
import { storage } from "@/lib/storage";

const Body = z.object({
  kind: z.enum(["material", "sample"]),
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative(),
});

/** Issues an upload target. The file bytes go straight to storage, never through this route. */
export async function POST(request: Request) {
  try {
    const { kind, filename, size } = await parseBody(request, Body);
    const check = classifyUpload(filename);
    if (!check.ok) throw new RequestError(check.message, 415);
    if (size === 0) throw new RequestError(`${filename} is empty.`);
    if (size > MAX_UPLOAD_BYTES) {
      throw new RequestError(`${filename} is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`, 413);
    }

    const userId = serverEnv("DEMO_USER_ID");
    if (kind === "material") {
      const [{ total }] = await db()
        .select({ total: count() })
        .from(chunks)
        .innerJoin(materials, eq(chunks.materialId, materials.id))
        .where(eq(materials.userId, userId));
      if (total >= MAX_CHUNKS) {
        throw new RequestError(
          `Your material has reached the ${MAX_CHUNKS}-chunk limit. Remove a file before adding more.`,
          409,
        );
      }
    }

    const storagePath = storagePathFor(userId, kind, randomUUID(), filename);
    const upload = await storage.createUploadTarget(storagePath, {
      contentType: check.contentType,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    return NextResponse.json({ storagePath, upload });
  } catch (error) {
    return errorResponse(error);
  }
}
