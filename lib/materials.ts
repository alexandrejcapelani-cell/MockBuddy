import "server-only";
import { and, asc, count, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { chunks, materials } from "@/lib/db/schema";
import { MAX_CHUNKS } from "@/lib/files";
import { ADMIN_TOPIC } from "@/lib/ingest/topic-labels";

export interface MaterialSummary {
  id: string;
  filename: string;
  status: (typeof materials.$inferSelect)["status"];
  error: string | null;
  pageCount: number | null;
  chunkCount: number;
  topics: string[];
}

/** `subjectId` must already be checked as the signed-in user's (lib/ownership.ts). */
export async function listMaterials(subjectId: string): Promise<MaterialSummary[]> {
  const rows = await db()
    .select({
      id: materials.id,
      filename: materials.filename,
      status: materials.status,
      error: materials.error,
      pageCount: materials.pageCount,
      ordinal: chunks.ordinal,
      topicLabel: chunks.topicLabel,
    })
    .from(materials)
    .leftJoin(chunks, eq(chunks.materialId, materials.id))
    .where(eq(materials.subjectId, subjectId))
    .orderBy(desc(materials.createdAt), asc(chunks.ordinal));

  const byId = new Map<string, MaterialSummary>();
  for (const row of rows) {
    let summary = byId.get(row.id);
    if (!summary) {
      summary = { ...row, chunkCount: 0, topics: [] };
      byId.set(row.id, summary);
    }
    if (row.ordinal !== null) summary.chunkCount++;
    if (row.topicLabel && !summary.topics.includes(row.topicLabel)) summary.topics.push(row.topicLabel);
  }
  return [...byId.values()];
}

export async function materialTotals(subjectId: string): Promise<{ chunks: number; topics: number; limit: number }> {
  const [{ total }] = await db()
    .select({ total: count() })
    .from(chunks)
    .innerJoin(materials, eq(chunks.materialId, materials.id))
    .where(eq(materials.subjectId, subjectId));
  const topics = await db()
    .selectDistinct({ label: chunks.topicLabel })
    .from(chunks)
    .innerJoin(materials, eq(chunks.materialId, materials.id))
    .where(and(eq(materials.subjectId, subjectId), isNotNull(chunks.topicLabel), ne(chunks.topicLabel, ADMIN_TOPIC)));
  return { chunks: total, topics: topics.length, limit: MAX_CHUNKS };
}
