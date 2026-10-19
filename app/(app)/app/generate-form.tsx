"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ExamDifficulty } from "@/lib/generation/types";
import { usePrefersReducedMotion } from "@/lib/motion";
import { postJson } from "@/lib/upload-client";

const COUNTS = [5, 10, 15, 20] as const;
const CHIP_COLOURS: Record<(typeof COUNTS)[number], { chip: string; ink: string }> = {
  5: { chip: "var(--chip-red)", ink: "var(--chip-cream)" },
  10: { chip: "var(--chip-cream)", ink: "var(--felt-deep)" },
  15: { chip: "var(--wood)", ink: "var(--chip-cream)" },
  20: { chip: "var(--gold)", ink: "var(--felt-deep)" },
};
const DIFFICULTIES: { level: ExamDifficulty; label: string; note: string }[] = [
  { level: "easier", label: "Easier", note: "Single-step recall and direct application, with shorter stems than your sample." },
  { level: "same", label: "Same", note: "Matches your sample exam's difficulty, stem length and reasoning steps." },
  { level: "harder", label: "Harder", note: "More reasoning steps: combining topics, new scenarios, working backwards." },
];
/** The lever gets this long to swing before the screen changes. Generation hasn't started yet. */
const LEVER_MS = 420;

/** Stakes and the lever: question count as poker chips, difficulty as a lever, then PULL. */
export function GenerateForm({ ready, reason }: { ready: boolean; reason: string | null }) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [difficulty, setDifficulty] = useState<ExamDifficulty>("same");
  const [pending, setPending] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const position = DIFFICULTIES.findIndex((d) => d.level === difficulty);

  async function pull() {
    setPending(true);
    setPulling(true);
    setError(null);
    const [result] = await Promise.all([
      postJson<{ examId: string }>("/api/exams", { questionCount: count, difficulty }),
      new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : LEVER_MS)),
    ]);
    setPulling(false);
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/spin/${result.data.examId}`);
  }

  return (
    <form
      className="grid items-center gap-8 md:grid-cols-[1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        void pull();
      }}
    >
      <div className="space-y-7">
        <fieldset className="space-y-3">
          <legend className="font-display text-xl font-semibold text-cream">How many questions?</legend>
          <div className="flex flex-wrap gap-5">
            {COUNTS.map((n) => (
              <label key={n} className="cursor-pointer">
                <input
                  type="radio"
                  name="count"
                  value={n}
                  checked={count === n}
                  onChange={() => setCount(n)}
                  className="peer sr-only"
                />
                <span
                  className="poker-chip tabular peer-checked:-translate-y-2 peer-checked:shadow-[0_0_0_3px_var(--gold-bright),0_10px_18px_-6px_rgb(0_0_0/0.7)] peer-focus-visible:outline-3 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold-bright"
                  style={{ "--chip-color": CHIP_COLOURS[n].chip, "--chip-ink": CHIP_COLOURS[n].ink } as React.CSSProperties}
                >
                  {n}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-display text-xl font-semibold text-cream">Difficulty, against your sample</legend>
          <div className="relative grid max-w-md grid-cols-3 rounded-full bg-felt-deep p-1 shadow-[inset_0_2px_6px_rgb(0_0_0/0.6)]">
            <span
              aria-hidden="true"
              className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-gradient-to-b from-gold-bright to-gold shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] transition-transform duration-200"
              style={{ transform: `translateX(${position * 100}%)` }}
            />
            {DIFFICULTIES.map((option) => (
              <label key={option.level} className="relative z-10 cursor-pointer text-center">
                <input
                  type="radio"
                  name="difficulty"
                  value={option.level}
                  checked={difficulty === option.level}
                  onChange={() => setDifficulty(option.level)}
                  className="peer sr-only"
                />
                <span className="block rounded-full py-2 text-sm font-bold tracking-[0.18em] text-cream uppercase peer-checked:text-felt-deep peer-focus-visible:outline-3 peer-focus-visible:outline-gold-bright">
                  {option.label}
                </span>
              </label>
            ))}
          </div>
          <p className="max-w-md text-sm text-dim">{DIFFICULTIES[position].note}</p>
        </fieldset>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          type="submit"
          disabled={!ready || pending}
          aria-describedby="pull-help"
          className={`slot-lever ${pulling && !reducedMotion ? "is-pulling" : ""}`}
        >
          <span className="slot-lever-arm" aria-hidden="true">
            <span className="slot-lever-ball" />
          </span>
          <span className="slot-lever-plate">{pending ? "Dealing…" : "Pull"}</span>
        </button>
        <p id="pull-help" className="max-w-[14rem] text-center text-sm text-dim">
          {ready ? `${count} questions, ${DIFFICULTIES[position].label.toLowerCase()} difficulty` : reason}
        </p>
        {error && (
          <p role="alert" className="max-w-xs text-center text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
