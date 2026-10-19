import Link from "next/link";
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
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <Link href="/" className="text-sm underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">Generating your mock</h1>
        <p className="text-sm text-muted-foreground">
          {progress.questionCount} questions · {DIFFICULTY_NAMES[progress.difficulty]} · each batch of 5 is drafted, checked
          by an examiner pass, and revised where needed
        </p>
      </header>
      <SpinRunner initial={progress} />
    </main>
  );
}
