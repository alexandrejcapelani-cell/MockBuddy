"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FreeMocksUsed } from "@/components/free-mocks-used";
import { postJson } from "@/lib/upload-client";

/** Same material, same sample exam, same count and difficulty; completely new questions. */
export function RegenerateButton({ examId, freeMocksLeft }: { examId: string; freeMocksLeft: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedUp, setUsedUp] = useState<string | null>(null);

  async function regenerate() {
    setPending(true);
    setError(null);
    const result = await postJson<{ examId: string }>("/api/regenerate", { examId });
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
    <div className="flex flex-col items-center gap-3 text-center">
      <button type="button" onClick={() => void regenerate()} disabled={pending} className="btn-gold px-10 py-4 text-xl">
        {pending ? "Shuffling…" : "Regenerate"}
      </button>
      <p className="max-w-md text-sm text-dim">
        A completely new mock from the same material and sample exam, at the same length and difficulty, written to avoid every
        question in this mock and the ones before it. Uses 1 of your {freeMocksLeft} free mock{freeMocksLeft === 1 ? "" : "s"} left.
      </p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </div>
  );
}
