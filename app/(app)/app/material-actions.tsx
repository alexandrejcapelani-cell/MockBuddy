"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/upload-client";
import { removeMaterial } from "./actions";

export function MaterialActions({ id, filename, failed }: { id: string; filename: string; failed: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"retry" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending("retry");
    setError(null);
    const result = await postJson("/api/materials/ingest", { materialId: id });
    if (!result.ok) setError(result.error);
    setPending(null);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Remove ${filename}? Questions generated from it are removed too.`)) return;
    setPending("remove");
    setError(null);
    try {
      const result = await removeMaterial(id);
      if (result.error) setError(result.error);
    } catch (caught) {
      setError(`Removing failed: ${(caught as Error).message}`);
    }
    setPending(null);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3 pt-1">
      {failed && (
        <button type="button" className="text-gold-text underline underline-offset-4" disabled={pending !== null} onClick={retry}>
          {pending === "retry" ? "Retrying…" : "Retry"}
        </button>
      )}
      <button
        type="button"
        className="text-dim underline underline-offset-4 hover:text-cream"
        disabled={pending !== null}
        onClick={remove}
        aria-label={`Remove ${filename}`}
      >
        {pending === "remove" ? "Removing…" : "Remove"}
      </button>
      {error && (
        <span role="alert" className="text-error">
          {error}
        </span>
      )}
    </span>
  );
}
