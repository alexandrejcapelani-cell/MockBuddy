"use client";

import { setSoundEnabled, useSoundEnabled } from "@/lib/sound";

/** Sound cues are off until the user turns them on. */
export function SoundToggle() {
  const enabled = useSoundEnabled();
  return (
    <button type="button" aria-pressed={enabled} onClick={() => setSoundEnabled(!enabled)} className="btn-quiet text-sm">
      <span aria-hidden="true">{enabled ? "🔊" : "🔈"}</span> Sound {enabled ? "on" : "off"}
    </button>
  );
}
