"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/motion";
import { playClick } from "@/lib/sound";
import { ChipCascade } from "./chip-cascade";

// Screen 2's slot machine (spec section 11). Three reels of the student's own topic
// labels spin while generation runs; as batches land they decelerate on an ease-out curve
// and lock left to right on the topics those batches drew from. Each lock shakes the
// cabinet and clicks; the jackpot flashes gold and drops chips. All of it is decorative:
// the parent never waits for it. Under prefers-reduced-motion the reels are static and a
// progress bar shows the same progress.

const ROW = 64; // px per label
const SPIN_SPEED = 1.9; // px per ms at full speed
const STOP_MS = 1150;
const MIN_LABELS = 10;

interface Props {
  topics: string[];
  /** How many reels, from the left, should be locked now (0 to 3). */
  locked: number;
  /** The label each reel lands on. */
  landOn: [string, string, string];
  /** 0 to 1. */
  progress: number;
  jackpot: boolean;
}

export function SlotMachine(props: Props) {
  const reducedMotion = usePrefersReducedMotion();
  return reducedMotion ? <StaticMachine {...props} /> : <SpinningMachine {...props} />;
}

function StaticMachine({ locked, landOn, progress, jackpot }: Props) {
  return (
    <div className="wood-frame rounded-[2rem] p-5 sm:p-7">
      <div className="grid grid-cols-3 gap-3">
        {landOn.map((label, i) => (
          <div key={i} className="flex h-24 items-center justify-center rounded-xl bg-chip-cream px-2 text-center text-card-ink">
            <span className="font-display text-base font-bold [overflow-wrap:anywhere] hyphens-auto sm:text-lg">{i < locked || jackpot ? label : "…"}</span>
          </div>
        ))}
      </div>
      <div
        role="progressbar"
        aria-label="Generation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="mt-5 h-3 overflow-hidden rounded-full bg-felt-deep"
      >
        <div className="h-full rounded-full bg-gold" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}

interface ReelState {
  position: number;
  mode: "spinning" | "stopping" | "locked";
  stop: { from: number; to: number; start: number } | null;
}

function SpinningMachine({ topics, locked, landOn, progress, jackpot }: Props) {
  const strips = useMemo(() => [0, 1, 2].map((reel) => reelLabels(topics, reel)), [topics]);
  const reels = useRef<ReelState[]>([0, 1, 2].map((reel) => ({ position: reel * ROW * 3, mode: "spinning", stop: null })));
  const stripRefs = useRef<(HTMLDivElement | null)[]>([]);
  const windowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cabinetRef = useRef<HTMLDivElement | null>(null);
  const [lockedCount, setLockedCount] = useState(0);

  // Start stopping any reel the parent has asked to lock.
  useEffect(() => {
    const target = jackpot ? 3 : locked;
    reels.current.forEach((reel, i) => {
      if (i >= target || reel.mode !== "spinning") return;
      const labels = strips[i];
      const height = labels.length * ROW;
      const index = Math.max(0, labels.indexOf(landOn[i]));
      // The landing label sits on the middle row, after at least two more turns of the reel.
      const landing = (((index - 1) * ROW) % height + height) % height;
      const ahead = (((landing - (reel.position % height)) % height) + height) % height;
      const delay = i * 220 * (jackpot && locked < 3 ? 1 : 0);
      reel.mode = "stopping";
      reel.stop = { from: reel.position, to: reel.position + 2 * height + ahead, start: performance.now() + delay };
    });
  }, [locked, jackpot, landOn, strips]);

  // One animation loop drives all three reels by writing transforms directly.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      reels.current.forEach((reel, i) => {
        const height = strips[i].length * ROW;
        if (reel.mode === "spinning" || (reel.mode === "stopping" && reel.stop && now < reel.stop.start)) {
          reel.position += SPIN_SPEED * dt;
        } else if (reel.mode === "stopping" && reel.stop) {
          const t = Math.min(1, (now - reel.stop.start) / STOP_MS);
          reel.position = reel.stop.from + (reel.stop.to - reel.stop.from) * (1 - (1 - t) ** 3);
          if (t >= 1) {
            reel.mode = "locked";
            setLockedCount((n) => n + 1);
            shake(cabinetRef.current);
            playClick();
          }
        }
        const strip = stripRefs.current[i];
        if (strip) strip.style.transform = `translate3d(0, ${-(reel.position % height)}px, 0)`;
        windowRefs.current[i]?.classList.toggle("reel-blur", reel.mode !== "locked" && !(reel.stop && now > reel.stop.start + STOP_MS * 0.55));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [strips]);

  const allLocked = lockedCount >= 3;
  return (
    <div ref={cabinetRef} className={`wood-frame relative rounded-[2rem] p-5 sm:p-7 ${allLocked && jackpot ? "animate-flash" : ""}`}>
      <div className="grid grid-cols-3 gap-3">
        {strips.map((labels, i) => (
          <div
            key={i}
            ref={(el) => {
              windowRefs.current[i] = el;
            }}
            className="reel-window relative min-w-0 overflow-hidden rounded-xl bg-chip-cream"
            style={{ height: ROW * 3 }}
            aria-hidden="true"
          >
            <div
              ref={(el) => {
                stripRefs.current[i] = el;
              }}
              className="will-change-transform"
            >
              {[...labels, ...labels].map((label, j) => (
                <div key={j} className="flex items-center justify-center px-2 text-center" style={{ height: ROW }}>
                  <span className="font-display text-sm leading-tight font-bold [overflow-wrap:anywhere] hyphens-auto text-card-ink sm:text-lg">{label}</span>
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 border-y-2 border-gold" style={{ top: ROW, height: ROW }} />
          </div>
        ))}
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-felt-deep" aria-hidden="true">
        <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      {allLocked && jackpot && <ChipCascade count={30} mode="fall" />}
    </div>
  );
}

/** Restarts the cabinet's shake animation. */
function shake(cabinet: HTMLDivElement | null) {
  if (!cabinet) return;
  cabinet.classList.remove("animate-shake");
  void cabinet.offsetWidth; // reflow, so the animation runs again
  cabinet.classList.add("animate-shake");
}

/** A reel's labels: the topics in a reel-specific order, repeated to fill the reel. */
function reelLabels(topics: string[], reel: number): string[] {
  const base = topics.length > 0 ? topics : ["Your material"];
  const rotated = [...base.slice(reel % base.length), ...base.slice(0, reel % base.length)];
  const labels: string[] = [];
  while (labels.length < MIN_LABELS) labels.push(...rotated);
  return labels;
}
