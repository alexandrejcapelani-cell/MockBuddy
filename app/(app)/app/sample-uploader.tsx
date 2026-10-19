"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DropZone } from "@/components/drop-zone";
import { type CallSummaryInput, summarizeCalls } from "@/lib/ai/pricing";
import { postJson, uploadFile } from "@/lib/upload-client";

type Phase = "idle" | "uploading" | "reading" | "done" | "failed";

/** Uploads one sample exam and builds its blueprint, replacing the current one. */
export function SampleUploader({ hasBlueprint }: { hasBlueprint: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const busy = phase === "uploading" || phase === "reading";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setPhase("uploading");
    const uploaded = await uploadFile(file, "sample");
    if (!uploaded.ok) {
      setPhase("failed");
      setMessage(uploaded.error);
      return;
    }
    setPhase("reading");
    const result = await postJson<{ calls: CallSummaryInput[] }>(
      "/api/blueprint",
      { storagePath: uploaded.data.storagePath, filename: file.name },
      { withApiKey: true },
    );
    if (!result.ok) {
      setPhase("failed");
      setMessage(result.error);
      return;
    }
    setPhase("done");
    setMessage(summarizeCalls(result.data.calls));
    router.refresh();
  }

  return (
    <div className="space-y-2 text-sm">
      <DropZone
        title={hasBlueprint ? "Drop a different sample exam" : "Drop one past exam or mock"}
        hint={hasBlueprint ? "It replaces the current one." : "PDF, TXT or Markdown. Just one file."}
        multiple={false}
        disabled={busy}
        tone="red"
        onFiles={(files) => void handleFile(files[0])}
      />
      <p aria-live="polite">
        {phase === "uploading" && "Uploading…"}
        {phase === "reading" && "Reading the exam and extracting its blueprint (up to a minute)…"}
        {phase === "done" && <span className="text-dim">Blueprint ready ({message}).</span>}
        {phase === "failed" && <span className="text-error">Failed: {message}</span>}
      </p>
    </div>
  );
}
