import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import Link from "next/link";
import { db } from "@/lib/db";
import { chunks, materials } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { ownedSubject } from "@/lib/ownership";
import { ADMIN_TOPIC } from "@/lib/ingest/topic-labels";

// Phase 1 debug view: every chunk with its labels, so chunking quality is visible before
// generation depends on it.
export const dynamic = "force-dynamic";

export default async function ChunksPage({ searchParams }: { searchParams: Promise<{ subject?: string }> }) {
  const user = await requireUser();
  const { subject: subjectId } = await searchParams;
  const subject = subjectId && isUuid(subjectId) ? await ownedSubject(user.id, subjectId) : null;
  const rows = subject ? await chunksOf(subject.id) : [];

  const topicCounts = new Map<string, number>();
  for (const row of rows) {
    const label = row.topicLabel ?? "(unlabelled)";
    topicCounts.set(label, (topicCounts.get(label) ?? 0) + 1);
  }
  const files = [...new Set(rows.map((row) => row.materialId))].map((id) => rows.filter((row) => row.materialId === id));

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 text-sm">
      <header className="space-y-1">
        <Link href={subject ? `/app?subject=${subject.id}` : "/app"} className="underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">Chunks</h1>
        <p className="text-muted-foreground">
          {rows.length} chunks from {files.length} files. Chunks labelled “{ADMIN_TOPIC}” are never used for questions.
        </p>
      </header>

      <section aria-labelledby="topics-heading" className="space-y-2">
        <h2 id="topics-heading" className="text-lg font-semibold">
          Topics ({topicCounts.size})
        </h2>
        <ul className="flex flex-wrap gap-2">
          {[...topicCounts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, n]) => (
              <li key={label} className="rounded border px-2 py-0.5">
                {label} <span className="text-muted-foreground">×{n}</span>
              </li>
            ))}
        </ul>
      </section>

      {files.map((fileRows) => (
        <section key={fileRows[0].materialId} className="space-y-2">
          <h2 className="text-lg font-semibold break-all">{fileRows[0].filename}</h2>
          <div className="relative overflow-x-auto">
            <table className="w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Section</th>
                <th className="py-1 pr-3">Topic</th>
                <th className="py-1 pr-3 text-right">Tokens</th>
                <th className="py-1">Content</th>
              </tr>
            </thead>
            <tbody>
              {fileRows.map((row) => (
                <tr key={row.chunkId} className="border-b align-top">
                  <td className="py-1 pr-3 tabular-nums">{row.ordinal}</td>
                  <td className="py-1 pr-3">{row.sectionLabel}</td>
                  <td className="py-1 pr-3">{row.topicLabel ?? <em>unlabelled</em>}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{row.tokenEstimate}</td>
                  <td className="py-1">
                    <details>
                      <summary className="cursor-pointer">{row.content.slice(0, 120)}…</summary>
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs">{row.content}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
        </section>
      ))}
    </main>
  );
}

/** Every chunk of the subject's material (the subject is already checked as the user's). */
function chunksOf(subjectId: string) {
  return db()
    .select({
      materialId: materials.id,
      filename: materials.filename,
      chunkId: chunks.id,
      ordinal: chunks.ordinal,
      sectionLabel: chunks.sectionLabel,
      topicLabel: chunks.topicLabel,
      tokenEstimate: chunks.tokenEstimate,
      content: chunks.content,
    })
    .from(chunks)
    .innerJoin(materials, eq(chunks.materialId, materials.id))
    .where(eq(materials.subjectId, subjectId))
    .orderBy(desc(materials.createdAt), asc(chunks.ordinal));
}

function isUuid(value: string) {
  return z.uuid().safeParse(value).success;
}
