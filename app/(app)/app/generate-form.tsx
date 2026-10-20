"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ExamDifficulty } from "@/lib/generation/types";
import { usePrefersReducedMotion } from "@/lib/motion";
import { FreeMocksUsed } from "@/components/free-mocks-used";
import { LeverSwitch } from "@/components/lever-switch";
import type { QuestionFormat } from "@/lib/generation/format";
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
const FORMAT_OPTIONS: { value: QuestionFormat; label: string; summary: string }[] = [
  { value: "mcq", label: "MCQ only", summary: "multiple choice only" },
  { value: "open", label: "Open-ended", summary: "open-ended only" },
  { value: "mixed", label: "Mixed", summary: "mixed formats" },
];

export interface SampleMix {
  mcqShare: number;
  hasMcq: boolean;
  hasOpen: boolean;
}

function formatNote(format: QuestionFormat, mix: SampleMix): string {
  if (format === "mixed") {
    if (!mix.hasMcq && !mix.hasOpen) return "Follows your sample exam's own mix of question types.";
    if (!mix.hasOpen) return "Follows your sample exam, which is all multiple choice.";
    if (!mix.hasMcq) return "Follows your sample exam, which is all written answers.";
    const mcq = Math.min(9, Math.max(1, Math.round(mix.mcqShare * 10)));
    return `Follows your sample exam: about ${mcq} in 10 multiple choice, the rest written.`;
  }
  if (format === "mcq") {
    return mix.hasMcq
      ? "Multiple choice only, in your sample's multiple-choice style."
      : "Multiple choice only. Your sample has none, so these follow its tone.";
  }
  const kinds = "short answers marked against a rubric, and calculations";
  return mix.hasOpen ? `Written answers only: ${kinds}, in your sample's style.` : `Written answers only (${kinds}). Your sample has none, so these follow its tone.`;
}

/** The lever gets this long to swing before the screen changes. Generation hasn't started yet. */
const LEVER_MS = 420;

/**
 * Stakes and the lever: question count as poker chips, difficulty as a lever, then PULL.
 * Each pull uses one of the account's free mocks; with none left, a note replaces the lever.
 */
export function GenerateForm({
  subjectId,
  ready,
  reason,
  freeMocksLeft,
  mix,
}: {
  subjectId: string;
  ready: boolean;
  reason: string | null;
  freeMocksLeft: number;
  mix: SampleMix;
}) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [difficulty, setDifficulty] = useState<ExamDifficulty>("same");
  const [format, setFormat] = useState<QuestionFormat>("mixed");
  const [pending, setPending] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedUp, setUsedUp] = useState<string | null>(null);
  const position = DIFFICULTIES.findIndex((d) => d.level === difficulty);

  async function pull() {
    setPending(true);
    setPulling(true);
    setError(null);
    const [result] = await Promise.all([
      postJson<{ examId: string }>("/api/exams", { subjectId, questionCount: count, difficulty, format }),
      new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : LEVER_MS)),
    ]);
    setPulling(false);
    if (!result.ok) {
      if (result.data.kind === "free_mocks_used") setUsedUp(result.error);
      else setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/spin/${result.data.examId}`);
  }

  if (freeMocksLeft <= 0 || usedUp) return <FreeMocksUsed message={usedUp} />;

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
          {/* All four chips on one row on a phone too, so 20 isn't left alone on a second row. */}
          <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:gap-5">
            {COUNTS.map((n) => (
              <label key={n} className="flex cursor-pointer justify-center">
                <input
                  type="radio"
                  name="count"
                  value={n}
                  checked={count === n}
                  onChange={() => setCount(n)}
                  className="peer sr-only"
                />
                <span
                  className="poker-chip aspect-square h-auto w-full max-w-14 text-base tabular sm:size-[4.25rem] sm:max-w-none sm:text-[1.15rem] peer-checked:-translate-y-2 peer-checked:shadow-[0_0_0_3px_var(--gold-bright),0_10px_18px_-6px_rgb(0_0_0/0.7)] peer-focus-visible:outline-3 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold-bright"
                  style={{ "--chip-color": CHIP_COLOURS[n].chip, "--chip-ink": CHIP_COLOURS[n].ink } as React.CSSProperties}
                >
                  {n}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <LeverSwitch
          legend="Difficulty, against your sample"
          name="difficulty"
          options={DIFFICULTIES.map((option) => ({ value: option.level, label: option.label }))}
          value={difficulty}
          onChange={setDifficulty}
          note={DIFFICULTIES[position].note}
        />

        <LeverSwitch
          legend="Question format"
          name="format"
          options={FORMAT_OPTIONS}
          value={format}
          onChange={setFormat}
          note={formatNote(format, mix)}
        />
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
          {ready ? `${count} questions, ${DIFFICULTIES[position].label.toLowerCase()} difficulty, ${FORMAT_OPTIONS.find((o) => o.value === format)!.summary}` : reason}
        </p>
        <p className="neon text-center text-lg font-bold">
          {freeMocksLeft} free mock{freeMocksLeft === 1 ? "" : "s"} left
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
