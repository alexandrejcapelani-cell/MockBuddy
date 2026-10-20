import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ownsExam } from "@/lib/ownership";
import { loadExamForTaking } from "@/lib/exam/taking";
import { examProgress } from "@/lib/generation/context";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import { FORMAT_NAMES } from "@/lib/generation/format";
import { RequestError } from "@/lib/http";
import { ExamTaker } from "./exam-taker";
import { LiveExam } from "./live-exam";

export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const user = await requireUser();
  if (!z.uuid().safeParse(examId).success || !(await ownsExam(user.id, examId))) notFound();
  const { exam, questions } = await loadExamForTaking(examId).catch((error: unknown) => {
    if (error instanceof RequestError && error.status === 404) notFound();
    throw error;
  });
  // Still generating: the questions saved so far can be answered while the rest are dealt.
  const progress = exam.status === "generating" ? await examProgress(examId) : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-1 text-center">
        <h1 className="font-display text-4xl font-bold text-gold-text">The hand</h1>
        <p className="text-dim">
          {progress ? exam.questionCount : questions.length} questions · {DIFFICULTY_NAMES[exam.difficulty]} ·{" "}
          {FORMAT_NAMES[exam.plan.format ?? "mixed"]}
          {progress && (
            <>
              {" "}
              · <Link href={`/spin/${examId}`}>watch the spin</Link>
            </>
          )}
        </p>
      </header>
      {progress ? (
        <LiveExam progress={progress} initial={questions} />
      ) : questions.length === 0 ? (
        <p className="panel p-5 text-center">
          This mock has no questions: every draft failed its checks. <Link href="/app">Deal a new one</Link>.
        </p>
      ) : (
        <ExamTaker examId={examId} questions={questions} dealing={null} />
      )}
    </main>
  );
}
