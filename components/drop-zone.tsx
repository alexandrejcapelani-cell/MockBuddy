"use client";

import { useId, useState } from "react";
import { PICKER_EXTENSIONS } from "@/lib/files";

/**
 * A drop zone on the felt: drag files onto it, or click (or press Enter/Space on it) to
 * browse. The real control is a visually hidden file input, so it is keyboard focusable
 * and gets the gold focus ring through the zone.
 */
export function DropZone({
  title,
  hint,
  multiple,
  disabled,
  tone,
  onFiles,
}: {
  title: string;
  hint: string;
  multiple: boolean;
  disabled: boolean;
  tone: "felt" | "red";
  onFiles: (files: File[]) => void;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const colours =
    tone === "red"
      ? "border-chip-red bg-chip-red/20 hover:bg-chip-red/30"
      : "border-gold/70 bg-felt-deep/40 hover:bg-felt-deep/60";

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(event.dataTransfer.files);
        onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-3 has-[input:focus-visible]:outline-gold-bright ${colours} ${over ? "ring-4 ring-gold-bright/60" : ""} ${disabled ? "cursor-progress opacity-75" : ""}`}
    >
      <span className="font-display text-lg font-semibold text-cream">{title}</span>
      <span className="text-sm text-dim">{hint}</span>
      <span className="mt-2 text-sm font-semibold text-gold-text underline underline-offset-4">Browse files</span>
      <input
        id={id}
        type="file"
        multiple={multiple}
        accept={PICKER_EXTENSIONS}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          onFiles(files);
        }}
      />
    </label>
  );
}
