import Link from "next/link";
import { activeBlueprint } from "@/lib/blueprint/extract-blueprint";
import { QUESTION_TYPE_NAMES } from "@/lib/blueprint/rules";
import { serverEnv } from "@/lib/env";
import { listMaterials, materialTotals } from "@/lib/materials";
import { MaterialActions } from "./material-actions";
import { MaterialUploader } from "./material-uploader";
import { SampleUploader } from "./sample-uploader";

// Plain UI until phase 6 brings the casino table.
export const dynamic = "force-dynamic";

export default async function TablePage() {
  const userId = serverEnv("DEMO_USER_ID");
  const [materials, totals, blueprint] = await Promise.all([
    listMaterials(userId),
    materialTotals(userId),
    activeBlueprint(userId),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MockBuddy</h1>
        <p className="text-sm text-muted-foreground">Practice exams from your own course material.</p>
      </header>

      <section aria-labelledby="material-heading" className="space-y-4">
        <h2 id="material-heading" className="text-lg font-semibold">
          Your material
        </h2>
        <MaterialUploader />
        {materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No material yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {materials.map((material) => (
              <li key={material.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium break-all">{material.filename}</span>
                  <MaterialActions id={material.id} filename={material.filename} failed={material.status === "failed"} />
                </div>
                <p className="text-muted-foreground">
                  {material.pageCount !== null && `${material.pageCount} pages · `}
                  {material.chunkCount} chunks · {statusText(material.status)}
                </p>
                {material.error && (
                  <p role="alert" className="text-destructive">
                    {material.error}
                  </p>
                )}
                {material.topics.length > 0 && <p>Topics: {material.topics.join(" · ")}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          {totals.topics} topics detected · {totals.chunks} of {totals.limit} chunks used ·{" "}
          <Link href="/debug/chunks" className="underline">
            Inspect chunks
          </Link>
        </p>
      </section>

      <section aria-labelledby="sample-heading" className="space-y-4">
        <h2 id="sample-heading" className="text-lg font-semibold">
          Your sample exam
        </h2>
        <SampleUploader hasBlueprint={blueprint !== null} />
        {blueprint ? (
          <div className="space-y-1 rounded-lg border px-3 py-2 text-sm">
            <p className="font-medium break-all">{blueprint.sourceFilename}</p>
            <ul className="text-muted-foreground">
              {blueprint.spec.sections.map((section, i) => (
                <li key={i}>
                  {section.name}: {QUESTION_TYPE_NAMES[section.question_type]}, {Math.round(section.proportion * 100)}% of
                  questions, {section.marks_each} marks each
                </li>
              ))}
            </ul>
            <p>
              {blueprint.sampleQuestions.length} sample questions copied verbatim ·{" "}
              <Link href="/blueprint" className="underline">
                Review the blueprint
              </Link>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No sample exam yet.</p>
        )}
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
