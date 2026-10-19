"use client";

import { useId, useRef, useState } from "react";

export interface ScorePoint {
  id: string;
  /** Short date for the axis and tooltip. */
  label: string;
  /** 0 to 100. */
  score: number;
  detail: string;
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 18, right: 48, bottom: 30, left: 40 };
const GRID = [0, 25, 50, 75, 100];

/**
 * Score over time: one gold line (2px, round joins) with ringed 8px markers on a hairline
 * grid, the latest score labelled directly, and a crosshair tooltip that snaps to the
 * nearest mock on hover or with the arrow keys. The history table is the chart's table
 * view, so every value is reachable without hovering.
 */
export function ScoreChart({ points, describedBy }: { points: ScorePoint[]; describedBy: string }) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (score: number) => PAD.top + (1 - score / 100) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  const shown = active ?? null;

  function nearest(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * WIDTH;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setActive(best);
  }

  return (
    <figure className="space-y-2">
      <figcaption id={titleId} className="font-display text-xl font-semibold">
        Score over time
      </figcaption>
      <div
        className="relative"
        tabIndex={0}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") setActive((i) => Math.min(last, (i ?? -1) + 1));
          else if (event.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? points.length) - 1));
          else return;
          event.preventDefault();
        }}
        onFocus={() => setActive((i) => i ?? last)}
        onBlur={() => setActive(null)}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full touch-none"
          aria-hidden="true"
          onPointerMove={(event) => nearest(event.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          {GRID.map((g) => (
            <g key={g}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(g)} y2={y(g)} stroke="rgb(244 239 228 / 0.16)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(g) + 4} textAnchor="end" fontSize={12} fill="var(--chip-dim)" className="tabular">
                {g}%
              </text>
            </g>
          ))}
          {points.length > 1 && (
            <>
              <text x={x(0)} y={HEIGHT - 8} textAnchor="start" fontSize={12} fill="var(--chip-dim)">
                {points[0].label}
              </text>
              {points[last].label !== points[0].label && (
                <text x={x(last)} y={HEIGHT - 8} textAnchor="end" fontSize={12} fill="var(--chip-dim)">
                  {points[last].label}
                </text>
              )}
            </>
          )}
          {shown !== null && (
            <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgb(244 239 228 / 0.45)" strokeWidth={1} />
          )}
          <path d={path} fill="none" stroke="var(--gold)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle
              key={p.id}
              cx={x(i)}
              cy={y(p.score)}
              r={shown === i ? 6 : 4}
              fill="var(--gold)"
              stroke="var(--felt)"
              strokeWidth={2}
            />
          ))}
          {/* Direct label on the latest point only. Text in a text colour, not the series colour. */}
          <text x={x(last) + 10} y={y(points[last].score) + 4} fontSize={13} fontWeight={700} fill="var(--chip-cream)" className="tabular">
            {Math.round(points[last].score)}%
          </text>
        </svg>
        {shown !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-lg border border-border bg-felt-deep px-3 py-2 text-sm shadow-lg"
            style={{
              left: `${(x(shown) / WIDTH) * 100}%`,
              transform: `translateX(${shown > points.length / 2 ? "-105%" : "5%"})`,
            }}
          >
            <p className="text-base font-bold text-cream tabular">{Math.round(points[shown].score)}%</p>
            <p className="text-dim">{points[shown].label}</p>
            <p className="text-dim">{points[shown].detail}</p>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {shown !== null ? `${points[shown].label}: ${Math.round(points[shown].score)}%, ${points[shown].detail}` : ""}
      </p>
      <p className="text-xs text-dim">Hover or focus the chart and use ← → to step through your mocks. Every score is also in the table below.</p>
    </figure>
  );
}
