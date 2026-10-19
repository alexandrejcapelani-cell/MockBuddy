import Link from "next/link";
import { activeBlueprint } from "@/lib/blueprint/extract-blueprint";
import { QUESTION_TYPE_NAMES } from "@/lib/blueprint/rules";
import { isConfigured, serverEnv } from "@/lib/env";
import { listMaterials, materialTotals } from "@/lib/materials";
import { ApiKeyField } from "./api-key-field";
import { GenerateForm } from "./generate-form";
import { MaterialActions } from "./material-actions";
import { MaterialUploader } from "./material-uploader";
import { SampleUploader } from "./sample-uploader";

// Screen 1, the table: material, one sample exam, the stakes and the lever.
export const dynamic = "force-dynamic";

export default async function TablePage() {
  const userId = serverEnv("DEMO_USER_ID");
  const [materials, totals, blueprint] = await Promise.all([
    listMaterials(userId),
    materialTotals(userId),
    activeBlueprint(userId),
  ]);

  const readiness =
    totals.topics === 0
      ? "Lay down some material first."
      : blueprint === null
        ? "Add one past exam first: the mock copies its style."
        : null;

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header className="space-y-2 text-center">
        <h1 className="font-display text-4xl font-bold text-gold-text sm:text-5xl">The table</h1>
        <p className="text-dim">Lay down your slides and one past exam, choose your stakes, and pull.</p>
      </header>

      {/* Only whether a server key exists reaches the page, never the key itself. */}
      <ApiKeyField serverKeyConfigured={isConfigured("GEMINI_API_KEY")} />

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="material-heading" className="panel space-y-4 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="material-heading" className="text-2xl font-semibold">
              Your material
            </h2>
            <p className="text-sm text-dim tabular">
              {totals.topics} topic{totals.topics === 1 ? "" : "s"} · {totals.chunks}/{totals.limit} chunks
            </p>
          </div>
          <MaterialUploader />
          {materials.length > 0 && (
            <ul className="space-y-3" aria-label="Uploaded material">
              {materials.map((material) => (
                <li key={material.id} className="flex gap-3">
                  <span
                    className="poker-chip shrink-0 text-xs tabular"
                    style={
                      {
                        "--chip-color": material.status === "failed" ? "var(--chip-red)" : "var(--chip-cream)",
                        "--chip-ink": material.status === "failed" ? "var(--chip-cream)" : "var(--felt-deep)",
                        width: "3.25rem",
                        height: "3.25rem",
                      } as React.CSSProperties
                    }
                    aria-hidden="true"
                  >
                    {material.pageCount !== null ? `${material.pageCount}p` : "txt"}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                    <p className="font-semibold break-all text-cream">{material.filename}</p>
                    <p className="text-dim">
                      {material.pageCount !== null && `${material.pageCount} pages · `}
                      {material.chunkCount} chunks · {statusText(material.status)}
                    </p>
                    {material.error && (
                      <p role="alert" className="text-error">
                        {material.error}
                      </p>
                    )}
                    {material.topics.length > 0 && <p className="text-dim">{material.topics.join(" · ")}</p>}
                    <MaterialActions id={material.id} filename={material.filename} failed={material.status === "failed"} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm">
            <Link href="/debug/chunks">Inspect how your material was chunked</Link>
          </p>
        </section>

        <section aria-labelledby="sample-heading" className="panel space-y-4 p-5">
          <h2 id="sample-heading" className="text-2xl font-semibold">
            Your sample exam
          </h2>
          <SampleUploader hasBlueprint={blueprint !== null} />
          {blueprint && (
            <div className="space-y-2 rounded-xl border border-chip-red/60 bg-felt-deep/50 p-3 text-sm">
              <p className="font-semibold break-all text-cream">{blueprint.sourceFilename}</p>
              <ul className="space-y-0.5 text-dim">
                {blueprint.spec.sections.map((section, i) => (
                  <li key={i}>
                    {section.name}: {QUESTION_TYPE_NAMES[section.question_type]}, {Math.round(section.proportion * 100)}% of
                    questions, {section.marks_each} marks each
                  </li>
                ))}
              </ul>
              <p>
                {blueprint.sampleQuestions.length} sample questions copied verbatim ·{" "}
                <Link href="/blueprint">Review the blueprint</Link>
              </p>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="stakes-heading" className="wood-frame rounded-3xl p-6 sm:p-8">
        <h2 id="stakes-heading" className="sr-only">
          Deal a mock
        </h2>
        <GenerateForm ready={readiness === null} reason={readiness} />
      </section>
    </main>
  );
}

function statusText(status: string): string {
  switch (status) {
    case "chunked":
      return "ready";
    case "extracting":
      return "processing…";
    case "failed":
      return "failed";
    default:
      return "uploaded, not processed yet";
  }
}
