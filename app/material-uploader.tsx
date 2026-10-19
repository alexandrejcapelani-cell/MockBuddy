"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PICKER_EXTENSIONS } from "@/lib/files";
import { postJson, uploadFile } from "@/lib/upload-client";

type Phase = "waiting" | "uploading" | "processing" | "done" | "failed";
interface FileProgress {
  key: string;
  name: string;
  phase: Phase;
  message?: string;
}

const PHASE_TEXT: Record<Phase, string> = {
  waiting: "Waiting",
  uploading: "Uploading…",
  processing: "Reading, chunking and labelling topics…",
  done: "Done",
  failed: "Failed",
};

interface IngestResponse {
  material: { status: string; pageCount: number | null };
}

/** Uploads material files one at a time and processes each as soon as it lands. */
export function MaterialUploader() {
  const router = useRouter();
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (key: string, change: Partial<FileProgress>) =>
    setProgress((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    const queue = files.map((file, i) => ({ file, key: `${Date.now()}-${i}` }));
    setProgress(queue.map(({ file, key }) => ({ key, name: file.name, phase: "waiting" })));

    for (const { file, key } of queue) {
      update(key, { phase: "uploading" });
      const uploaded = await uploadFile(file, "material");
      if (!uploaded.ok) {
        update(key, { phase: "failed", message: uploaded.error });
        continue;
      }
      update(key, { phase: "processing" });
      const ingested = await postJson<IngestResponse>("/api/materials/ingest", {
        storagePath: uploaded.data.storagePath,
        filename: file.name,
      });
      update(key, ingested.ok ? { phase: "done" } : { phase: "failed", message: ingested.error });
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="font-medium">Add material files</span>{" "}
        <span className="text-muted-foreground">(PDF, TXT or Markdown; several at once is fine)</span>
        <input
          type="file"
          multiple
          accept={PICKER_EXTENSIONS}
          disabled={busy}
          className="mt-1 block text-sm"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void handleFiles(files);
          }}
        />
      </label>
      {progress.length > 0 && (
        <ul aria-live="polite" className="space-y-1 text-sm">
          {progress.map((item) => (
            <li key={item.key}>
              <span className="font-medium">{item.name}</span>: {PHASE_TEXT[item.phase]}
              {item.message && <span className={item.phase === "failed" ? " text-destructive" : ""}> {item.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
