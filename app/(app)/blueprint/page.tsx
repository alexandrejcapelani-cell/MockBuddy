import Link from "next/link";
import { activeBlueprint } from "@/lib/blueprint/extract-blueprint";
import { QUESTION_TYPE_NAMES } from "@/lib/blueprint/rules";
import { serverEnv } from "@/lib/env";

// Phase 2 review page: the blueprint and the verbatim sample questions, so you can check
// they reflect the real paper before anything is generated from them.
export const dynamic = "force-dynamic";

export default async function BlueprintPage() {
  const blueprint = await activeBlueprint(serverEnv("DEMO_USER_ID"));

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 text-sm">
      <header className="space-y-1">
        <Link href="/app" className="underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">Blueprint</h1>
        {blueprint && (
          <p className="text-muted-foreground">
            From {blueprint.sourceFilename}, read {blueprint.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
        )}
      </header>

      {!blueprint ? (
        <p>No sample exam yet. Upload one on the home page.</p>
      ) : (
        <>
          <section aria-labelledby="overview-heading" className="space-y-2">
            <h2 id="overview-heading" className="text-lg font-semibold">
              Overview
            </h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
              <dt className="font-medium">Duration</dt>
              <dd>{blueprint.spec.duration_minutes === null ? "not stated" : `${blueprint.spec.duration_minutes} minutes`}</dd>
              <dt className="font-medium">Instructions</dt>
              <dd>{blueprint.spec.instructions_style}</dd>
              <dt className="font-medium">Tone</dt>
              <dd>{blueprint.spec.tone_notes}</dd>
            </dl>
          </section>

          <section aria-labelledby="sections-heading" className="space-y-2">
            <h2 id="sections-heading" className="text-lg font-semibold">
              Sections
            </h2>
            <div className="relative overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-3">Section</th>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 pr-3 text-right">Share</th>
                  <th className="py-1 pr-3 text-right">Marks each</th>
                  <th className="py-1 pr-3">Difficulty</th>
                  <th className="py-1">Style</th>
                </tr>
              </thead>
              <tbody>
                {blueprint.spec.sections.map((section, i) => (
                  <tr key={i} className="border-b align-top">
                    <td className="py-1 pr-3">{section.name}</td>
                    <td className="py-1 pr-3">{QUESTION_TYPE_NAMES[section.question_type]}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{Math.round(section.proportion * 100)}%</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{section.marks_each}</td>
                    <td className="py-1 pr-3">{section.observed_difficulty}</td>
                    <td className="py-1">{section.style_notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>

          <section aria-labelledby="samples-heading" className="space-y-2">
            <h2 id="samples-heading" className="text-lg font-semibold">
              Sample questions, verbatim ({blueprint.sampleQuestions.length})
            </h2>
            <p className="text-muted-foreground">
              Each was checked to appear word for word in the uploaded paper. They are shown to the model as style
              examples for every mock, and are never asked again.
            </p>
            <ol className="space-y-3">
              {blueprint.sampleQuestions.map((sample, i) => (
                <li key={i} className="rounded border p-3">
                  <p className="mb-1 font-medium">{QUESTION_TYPE_NAMES[sample.type]}</p>
                  <p className="whitespace-pre-wrap">{sample.verbatim_text}</p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
