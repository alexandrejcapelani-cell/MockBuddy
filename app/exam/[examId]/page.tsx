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
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <Link href="/" className="text-sm underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">Your mock</h1>
        <p className="text-sm text-muted-foreground">
          {questions.length} questions · {DIFFICULTY_NAMES[exam.difficulty]}
        </p>
      </header>
      {exam.status === "generating" ? (
        <p>
          This mock is still being generated.{" "}
          <Link href={`/spin/${examId}`} className="underline">
            Go back to the generation page
          </Link>
          .
        </p>
      ) : questions.length === 0 ? (
        <p>This mock has no questions: every draft failed its checks. Generate a new one from the home page.</p>
      ) : (
        <ExamTaker examId={examId} initial={questions} />
      )}
    </main>
  );
}
