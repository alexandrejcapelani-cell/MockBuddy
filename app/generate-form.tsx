"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIFFICULTY_NAMES } from "@/lib/generation/difficulty";
import type { ExamDifficulty } from "@/lib/generation/types";
import { postJson } from "@/lib/upload-client";

const COUNTS = [5, 10, 15, 20] as const;
const DIFFICULTIES: ExamDifficulty[] = ["easier", "same", "harder"];

/** Question count, difficulty and the button that starts generation. Plain until phase 6. */
export function GenerateForm({ ready, reason }: { ready: boolean; reason: string | null }) {
  const router = useRouter();
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [difficulty, setDifficulty] = useState<ExamDifficulty>("same");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    const result = await postJson<{ examId: string }>("/api/exams", { questionCount: count, difficulty });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/spin/${result.data.examId}`);
  }

  return (
    <form
      className="space-y-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <fieldset className="space-y-1">
        <legend className="font-medium">Questions</legend>
        <div className="flex gap-4">
          {COUNTS.map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input type="radio" name="count" value={n} checked={count === n} onChange={() => setCount(n)} />
              {n}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="font-medium">Difficulty, relative to the sample</legend>
        <div className="flex gap-4">
          {DIFFICULTIES.map((level) => (
            <label key={level} className="flex items-center gap-1">
              <input type="radio" name="difficulty" value={level} checked={difficulty === level} onChange={() => setDifficulty(level)} />
              {DIFFICULTY_NAMES[level]}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={!ready || pending} className="rounded border px-3 py-1 font-medium disabled:opacity-50">
        {pending ? "Setting up…" : "Generate mock"}
      </button>
      {!ready && reason && <p className="text-muted-foreground">{reason}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
