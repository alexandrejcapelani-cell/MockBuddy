import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { activeBlueprint } from "@/lib/blueprint/extract-blueprint";
import { QUESTION_TYPE_NAMES } from "@/lib/blueprint/rules";
import { sampleMix } from "@/lib/generation/format";
import { freeMocksLeft } from "@/lib/generation/quota";
import { listMaterials, materialTotals } from "@/lib/materials";
import { listSubjects } from "@/lib/subjects";
import { GenerateForm } from "./generate-form";
import { MaterialActions } from "./material-actions";
import { MaterialUploader } from "./material-uploader";
import { SampleUploader } from "./sample-uploader";
import { SubjectForm } from "./subject-form";

// Screen 1, the table: pick (or add) a subject, then its material, one sample exam, the
// stakes and the lever. The subject strip is the grading contract's core feature.
export const dynamic = "force-dynamic";

export default async function TablePage({ searchParams }: { searchParams: Promise<{ subject?: string }> }) {
  const user = await requireUser();
  const [subjects, left, { subject: requested }] = await Promise.all([listSubjects(user.id), freeMocksLeft(user.id), searchParams]);
  // The subject in the URL if it's one of the user's, otherwise the newest.
  const selected = subjects.find((subject) => subject.id === requested) ?? subjects[0] ?? null;

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header className="space-y-2 text-center">
        <h1 className="font-display text-4xl font-bold text-gold-text sm:text-5xl">The table</h1>
        <p className="text-dim">Pick a subject, lay down your slides and one past exam, choose your stakes, and pull.</p>
      </header>

      <section aria-labelledby="subjects-heading" className="panel space-y-4 p-5">
        <h2 id="subjects-heading" className="text-2xl font-semibold">
          Your subjects
        </h2>
        {subjects.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Subjects">
            {subjects.map((subject) => (
              <li key={subject.id}>
                <Link
                  href={`/app?subject=${subject.id}`}
                  data-testid="core-item"
                  aria-current={subject.id === selected?.id ? "page" : undefined}
                  className={`inline-block rounded-full border-2 px-4 py-1.5 font-semibold no-underline [overflow-wrap:anywhere] ${
                    subject.id === selected?.id
                      ? "border-gold-bright bg-gold text-felt-deep"
                      : "border-gold/60 text-cream hover:border-gold-bright"
                  }`}
                >
                  {subject.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-dim">Start by adding the subject you&rsquo;re revising for. Its material, sample exam and mocks live together.</p>
        )}
        <SubjectForm />
      </section>

      {selected && <SubjectTable subjectId={selected.id} subjectName={selected.name} freeMocksLeft={left} />}
    </main>
  );
}

/** Everything for one subject (already checked as the user's): material, sample exam, lever. */
async function SubjectTable({ subjectId, subjectName, freeMocksLeft }: { subjectId: string; subjectName: string; freeMocksLeft: number }) {
  const [materials, totals, blueprint] = await Promise.all([
    listMaterials(subjectId),
    materialTotals(subjectId),
    activeBlueprint(subjectId),
  ]);

  const readiness =
    totals.topics === 0
      ? "Lay down some material first."
      : blueprint === null
        ? "Add one past exam first: the mock copies its style."
        : null;

  return (
    <section aria-label={subjectName} className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="material-heading" className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="material-heading" className="text-2xl font-semibold">
              Your material
            </h2>
            <p className="text-sm text-dim tabular">
              {totals.topics} topic{totals.topics === 1 ? "" : "s"} · {totals.chunks}/{totals.limit} chunks
            </p>
          </div>
          <MaterialUploader subjectId={subjectId} />
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
                      {material.chunkCount} chunk{material.chunkCount === 1 ? "" : "s"} · {statusText(material.status)}
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
            <Link href={`/debug/chunks?subject=${subjectId}`}>Inspect how your material was chunked</Link>
          </p>
        </section>

        <section aria-labelledby="sample-heading" className="panel space-y-4 p-5">
          <h2 id="sample-heading" className="text-2xl font-semibold">
            Your sample exam
          </h2>
          <SampleUploader subjectId={subjectId} hasBlueprint={blueprint !== null} />
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
                <Link href={`/blueprint?subject=${subjectId}`}>Review the blueprint</Link>
              </p>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="stakes-heading" className="wood-frame rounded-3xl p-6 sm:p-8">
        <h2 id="stakes-heading" className="sr-only">
          Deal a mock
        </h2>
        <GenerateForm
          subjectId={subjectId}
          ready={readiness === null}
          reason={readiness}
          freeMocksLeft={freeMocksLeft}
          mix={sampleMix(blueprint?.spec.sections ?? [])}
        />
      </section>
    </section>
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
