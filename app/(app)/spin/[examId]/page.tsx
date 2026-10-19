import { notFound } from "next/navigation";
import { z } from "zod";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import { examProgress } from "@/lib/generation/context";
import { RequestError } from "@/lib/http";
import { SpinRunner } from "./spin-runner";

export const dynamic = "force-dynamic";

export default async function SpinPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  if (!z.uuid().safeParse(examId).success) notFound();
  const progress = await examProgress(examId).catch((error: unknown) => {
    if (error instanceof RequestError && error.status === 404) notFound();
    throw error;
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-4xl font-bold text-gold-text">The spin</h1>
        <p className="text-dim">
          {progress.questionCount} questions · {DIFFICULTY_NAMES[progress.difficulty]} · every batch of 5 is drafted, checked by an
          examiner pass and revised where needed
        </p>
      </header>
      <SpinRunner initial={progress} />
    </main>
  );
}
