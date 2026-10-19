"use client";

import { useSyncExternalStore } from "react";

// prefers-reduced-motion, for components that swap to a static variant (the slot machine
// becomes a progress bar, the chip cascade and count-up are skipped). CSS animations are
// also switched off globally in globals.css.

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the user asked for less motion. Assumed true while rendering on the server. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}
