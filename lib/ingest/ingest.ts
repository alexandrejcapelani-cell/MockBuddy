import "server-only";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { type CallMetrics, ModelCallError } from "@/lib/ai/call";
import type { ApiKey } from "@/lib/api-key";
import { db } from "@/lib/db";
import { chunks, materials } from "@/lib/db/schema";
import { classifyUpload, isOwnedStoragePath, MAX_CHUNKS } from "@/lib/files";
import { StorageNotFoundError, storage } from "@/lib/storage";
import { type ChunkDraft, chunkUnits, unitsFromMarkdown, unitsFromPages, unitsFromPlainText } from "./chunk";
import { DocumentError, extractDocument } from "./extract";
import { labelTopics } from "./label-topics";

// Stage A of the pipeline: extract → chunk → topic-label one uploaded material file.

export type Material = typeof materials.$inferSelect;

/** A request the student can fix, with the HTTP status the route should answer with. */
export class IngestError extends Error {
  override name = "IngestError";
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 415 | 422,
  ) {
    super(message);
  }
}

export async function createMaterial(userId: string, storagePath: string, filename: string): Promise<Material> {
  if (!isOwnedStoragePath(storagePath, userId, "material")) {
    throw new IngestError("That storage path wasn't issued for your material uploads.", 400);
  }
  const [material] = await db()
    .insert(materials)
    .values({ userId, filename, storagePath, status: "uploaded" })
    .returning();
  return material;
}

export async function getOwnedMaterial(userId: string, materialId: string): Promise<Material> {
  const [material] = await db()
    .select()
    .from(materials)
    .where(and(eq(materials.id, materialId), eq(materials.userId, userId)));
  if (!material) throw new IngestError("That material doesn't exist (it may have been removed).", 404);
  return material;
}

/**
 * Runs whatever is left to do for a material: extraction and chunking if it has no chunks
 * yet, then topic labelling for any unlabelled chunks. Safe to call again after a failure;
 * on any error the material is marked failed with a reason, and the error is rethrown.
 */
export async function processMaterial(
  material: Material,
  deadlineAt: number | undefined,
  apiKey: ApiKey,
): Promise<{ material: Material; calls: CallMetrics[] }> {
  if (material.status === "chunked") return { material, calls: [] };
  await setStatus(material.id, { status: "extracting", error: null });
  try {
    const [{ existing }] = await db().select({ existing: count() }).from(chunks).where(eq(chunks.materialId, material.id));
    if (existing === 0) await extractAndChunk(material);
    const calls = await labelUnlabelledChunks(material, deadlineAt, apiKey);
    return { material: await setStatus(material.id, { status: "chunked", error: null }), calls };
  } catch (error) {
    await setStatus(material.id, { status: "failed", error: failureReason(error) });
    throw error;
  }
}

async function extractAndChunk(material: Material) {
  const check = classifyUpload(material.filename);
  if (!check.ok) throw new IngestError(check.message, 415);

  const bytes = await storage.read(material.storagePath);
  const document = await extractDocument(bytes, check.kind);
  const units =
    check.kind === "pdf"
      ? unitsFromPages(document.pages)
      : check.kind === "markdown"
        ? unitsFromMarkdown(document.pages[0])
        : unitsFromPlainText(document.pages[0]);
  const drafts = chunkUnits(units);
  if (drafts.length === 0) throw new DocumentError("No text could be read from this file.");

  await insertChunksWithinCap(material, drafts, document.pageCount);
}

/** Inserts the chunks unless they would take the student's material past MAX_CHUNKS. */
async function insertChunksWithinCap(material: Material, drafts: ChunkDraft[], pageCount: number | null) {
  await db().transaction(async (tx) => {
    // Serialises concurrent uploads by the same user so two files can't both pass the cap check.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${material.userId}))`);
    const [{ total }] = await tx
      .select({ total: count() })
      .from(chunks)
      .innerJoin(materials, eq(chunks.materialId, materials.id))
      .where(eq(materials.userId, material.userId));
    if (total + drafts.length > MAX_CHUNKS) {
      throw new IngestError(
        `${material.filename} would add ${drafts.length} chunks to your ${total}, past the ${MAX_CHUNKS}-chunk limit. ` +
          `Remove some material or upload a shorter file (${Math.max(0, MAX_CHUNKS - total)} chunks left).`,
        409,
      );
    }
    await tx.insert(chunks).values(
      drafts.map((draft) => ({
        materialId: material.id,
        ordinal: draft.ordinal,
        sectionLabel: draft.sectionLabel,
        content: draft.content,
        tokenEstimate: draft.tokenEstimate,
      })),
    );
    await tx.update(materials).set({ pageCount }).where(eq(materials.id, material.id));
  });
}

async function labelUnlabelledChunks(material: Material, deadlineAt: number | undefined, apiKey: ApiKey): Promise<CallMetrics[]> {
  const unlabelled = await db()
    .select({ id: chunks.id, ordinal: chunks.ordinal, sectionLabel: chunks.sectionLabel, content: chunks.content })
    .from(chunks)
    .where(and(eq(chunks.materialId, material.id), isNull(chunks.topicLabel)))
    .orderBy(asc(chunks.ordinal));
  if (unlabelled.length === 0) return [];

  const existing = await db()
    .selectDistinct({ label: chunks.topicLabel })
    .from(chunks)
    .innerJoin(materials, eq(chunks.materialId, materials.id))
    .where(and(eq(materials.userId, material.userId), isNotNull(chunks.topicLabel)));

  const { labels, calls } = await labelTopics(
    unlabelled.map((chunk) => ({ index: chunk.ordinal, sectionLabel: chunk.sectionLabel, content: chunk.content })),
    existing.flatMap((row) => (row.label ? [row.label] : [])),
    { materialId: material.id, deadlineAt, apiKey },
  );

  await db().transaction(async (tx) => {
    for (const chunk of unlabelled) {
      await tx.update(chunks).set({ topicLabel: labels.get(chunk.ordinal) }).where(eq(chunks.id, chunk.id));
    }
  });
  return calls;
}

async function setStatus(materialId: string, values: Pick<Material, "status" | "error">): Promise<Material> {
  const [updated] = await db().update(materials).set(values).where(eq(materials.id, materialId)).returning();
  return updated;
}

function failureReason(error: unknown): string {
  if (error instanceof IngestError || error instanceof DocumentError || error instanceof StorageNotFoundError) {
    return error.message;
  }
  if (error instanceof ModelCallError) return `Topic labelling failed: ${error.message}`;
  return "Processing failed unexpectedly. Try again, and check the server log if it keeps failing.";
}
