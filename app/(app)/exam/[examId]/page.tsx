import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { loadExamForTaking } from "@/lib/exam/taking";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import { RequestError } from "@/lib/http";
import { ExamTaker } from "./exam-taker";

export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  if (!z.uuid().safeParse(examId).success) notFound();
  const { exam, questions } = await loadExamForTaking(examId).catch((error: unknown) => {
    if (error instanceof RequestError && error.status === 404) notFound();
    throw error;
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-4xl font-bold text-gold-text">The hand</h1>
        <p className="text-dim">
          {questions.length} questions · {DIFFICULTY_NAMES[exam.difficulty]}
        </p>
      </header>
      {exam.status === "generating" ? (
        <p className="panel p-5 text-center">
          This mock is still being dealt. <Link href={`/spin/${examId}`}>Go back to the spin</Link>.
        </p>
      ) : questions.length === 0 ? (
        <p className="panel p-5 text-center">
          This mock has no questions: every draft failed its checks. <Link href="/app">Deal a new one</Link>.
        </p>
      ) : (
        <ExamTaker examId={examId} initial={questions} />
      )}
    </main>
  );
}
