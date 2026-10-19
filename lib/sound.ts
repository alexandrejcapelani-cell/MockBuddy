"use client";

import { useSyncExternalStore } from "react";

// Sound cues: a short win chime and a reel-lock click, synthesised with Web Audio so there
// are no files to load. Muted by default; the choice is remembered in this browser only.

const STORAGE_KEY = "mockbuddy.sound";
const CHANGE_EVENT = "mockbuddy:sound-changed";

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false; // storage blocked: stay muted
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } finally {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, () => false);
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!readEnabled() || typeof window.AudioContext === "undefined") return null;
  context ??= new window.AudioContext();
  return context;
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, volume: number, type: OscillatorType = "sine") {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** A rising three-note chime for a correct answer. */
export function playWin(): void {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [659.25, 830.61, 987.77].forEach((frequency, i) => tone(ctx, frequency, now + i * 0.09, 0.35, 0.12, "triangle"));
}

/** A short mechanical click when a reel locks. */
export function playClick(): void {
  const ctx = audio();
  if (!ctx) return;
  tone(ctx, 180, ctx.currentTime, 0.06, 0.2, "square");
}
