import type { ExamDifficulty } from "./types.ts";

// MOCKBUDDY_SPEC.md section 10. The model always gets the definition, never the adjective alone.

export const DIFFICULTY_DEFINITIONS: Record<ExamDifficulty, string> = {
  easier:
    "EASIER: single-step recall or direct application from one chunk. The correct answer follows from one stated definition or formula. Distractors are plausible but differ on an obvious dimension. Stems are shorter than the sample's.",
  same:
    "SAME: match the observed difficulty of the sample exam as recorded in the blueprint (each slot states its section's observed difficulty). Comparable stem length, comparable number of reasoning steps.",
  harder:
    "HARDER: requires combining two chunks, or applying a principle to a scenario not present in the material, or reasoning backwards from a result to a cause. Distractors represent errors a student who mostly understands the topic would still make. Never harder by being vaguer or by hinging on an obscure detail: harder by requiring more reasoning steps.",
};

export const DIFFICULTY_NAMES: Record<ExamDifficulty, string> = {
  easier: "Easier",
  same: "Same level",
  harder: "Harder",
};
