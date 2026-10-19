"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePrefersReducedMotion } from "@/lib/motion";

const COLOURS = ["var(--chip-red)", "var(--chip-cream)", "var(--gold)", "var(--wood)"];

/**
 * Poker chips falling from the top of the screen ("fall") or bursting out of a card
 * ("burst"): plain transform animations on a few dozen elements, no physics. Decorative
 * only, hidden from assistive tech, and not rendered at all under prefers-reduced-motion.
 */
export function ChipCascade({ count, mode, onDone }: { count: number; mode: "fall" | "burst"; onDone?: () => void }) {
  const reducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(true);
  const chips = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * (mode === "fall" ? 600 : 120),
        duration: mode === "fall" ? 1400 + Math.random() * 900 : 700 + Math.random() * 400,
        drift: (Math.random() - 0.5) * (mode === "fall" ? 160 : 260),
        rise: -60 - Math.random() * 160,
        spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
        colour: COLOURS[i % COLOURS.length],
        size: 18 + Math.random() * 14,
      })),
    [count, mode],
  );
  const longest = Math.max(...chips.map((c) => c.delay + c.duration));

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, longest + 100);
    return () => clearTimeout(timer);
  }, [longest, onDone]);

  if (reducedMotion || !visible) return null;
  const layer = (
    <div
      aria-hidden="true"
      className={mode === "fall" ? "pointer-events-none fixed inset-0 z-50 overflow-hidden" : "pointer-events-none absolute inset-0 z-20 overflow-visible"}
    >
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="absolute rounded-full"
          style={
            {
              left: mode === "fall" ? `${chip.left}%` : "50%",
              top: mode === "fall" ? 0 : "40%",
              width: chip.size,
              height: chip.size,
              background: `radial-gradient(circle, ${chip.colour} 0 52%, transparent 53%), repeating-conic-gradient(${chip.colour} 0 20deg, rgb(255 255 255 / 0.9) 20deg 32deg)`,
              boxShadow: "0 3px 6px rgb(0 0 0 / 0.45)",
              animation: `${mode === "fall" ? "chip-fall" : "chip-burst"} ${chip.duration}ms ${chip.delay}ms cubic-bezier(0.3, 0.6, 0.4, 1) both`,
              "--drift": `${chip.drift}px`,
              "--dx": `${chip.drift}px`,
              "--dy": `${chip.rise}px`,
              "--spin": `${chip.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
  // Falling chips cover the whole screen, so they render at the root: inside a shaking
  // (transformed) cabinet, position: fixed would be trapped in the cabinet.
  return mode === "fall" ? createPortal(layer, document.body) : layer;
}
