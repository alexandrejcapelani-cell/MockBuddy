"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/upload-client";

/** Same material, same sample exam, same count and difficulty; completely new questions. */
export function RegenerateButton({ examId }: { examId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setPending(true);
    setError(null);
    const result = await postJson<{ examId: string }>("/api/regenerate", { examId });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`/spin/${result.data.examId}`);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void regenerate()}
        disabled={pending}
        className="rounded border-2 border-foreground px-6 py-3 text-lg font-semibold disabled:opacity-60"
      >
        {pending ? "Setting up…" : "REGENERATE"}
      </button>
      <p className="text-sm text-muted-foreground">
        A completely new mock from the same material and sample exam, at the same length and difficulty, written to
        avoid every question in this mock and the ones before it.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
