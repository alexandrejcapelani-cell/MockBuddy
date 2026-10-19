import type { GeneratedQuestion, Level, QuestionType } from "../schemas.ts";

// Shapes stored in jsonb columns by the generation pipeline (stage C).

export type ExamDifficulty = "easier" | "same" | "harder";

/** One question to write: what type, for which section, from which chunk(s). */
export interface PlanSlot {
  /** 1-based. Top-up slots continue after the initial ones; questions are renumbered at the end. */
  ordinal: number;
  type: QuestionType;
  sectionName: string;
  marks: number;
  styleNotes: string;
  observedDifficulty: Level;
  chunkId: string;
  /** A second chunk to combine with, for HARDER questions; null otherwise. */
  secondaryChunkId: string | null;
  topicLabel: string;
  /** For a top-up slot, the dropped slot it replaces. */
  replacesSlot: number | null;
}

/** `exams.plan`: every slot is assigned up front, so batches don't depend on each other. */
export interface ExamPlan {
  version: 1;
  slots: PlanSlot[];
}

export type BatchStage = "draft" | "draft_retry" | "critique" | "revise" | "done" | "failed";

/** A slot's current draft. `question` is null while it fails validation; `issues` says why. */
export interface DraftSlot {
  slot: number;
  question: GeneratedQuestion | null;
  /** The last rejected attempt, kept so the retry can show it to the model. */
  rejected: GeneratedQuestion | null;
  issues: string[];
}

export interface SlotVerdict {
  slot: number;
  verdict: "pass" | "revise";
  /** The examiner's instructions, plus any automatic findings such as a near-duplicate stem. */
  instructions: string[];
}

export interface SlotOutcome {
  slot: number;
  status: "accepted" | "dropped";
  revised: boolean;
  reason: string | null;
}

export interface StageMetrics {
  stage: Exclude<BatchStage, "done" | "failed">;
  label: string;
  servedBy: string | null;
  attempts: number;
  retries429: number;
  retriesOther: number;
  waitedMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  stopReason: string | null;
  outcome: string;
}

export type ExamDifficultyLabel = Record<ExamDifficulty, string>;
