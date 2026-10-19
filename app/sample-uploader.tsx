"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type CallSummaryInput, summarizeCalls } from "@/lib/ai/pricing";
import { PICKER_EXTENSIONS } from "@/lib/files";
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
    <div className="space-y-1 text-sm">
      <label className="block">
        <span className="font-medium">{hasBlueprint ? "Replace the sample exam" : "Add one past exam or mock"}</span>{" "}
        <span className="text-muted-foreground">(PDF, TXT or Markdown)</span>
        <input
          type="file"
          accept={PICKER_EXTENSIONS}
          disabled={busy}
          className="mt-1 block"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void handleFile(file);
          }}
        />
      </label>
      <p aria-live="polite">
        {phase === "uploading" && "Uploading…"}
        {phase === "reading" && "Reading the exam and extracting its blueprint (this takes up to a minute)…"}
        {phase === "done" && `Blueprint ready (${message}).`}
        {phase === "failed" && <span className="text-destructive">Failed: {message}</span>}
      </p>
    </div>
  );
}
