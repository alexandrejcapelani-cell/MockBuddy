import type { BatchStage, DraftSlot, SlotOutcome } from "./types.ts";

// The question stems a batch must stay clear of ("existing questions" in its prompts and in
// the word-overlap check). A mock's batches run at the same time, so besides the questions
// already saved this includes the drafts of the mock's other batches that are still being
// worked on. Of two batches, the one that reaches its critique second always sees the
// other's draft (a batch saves its draft before its critique starts), so it is the one whose
// question changes, and the batch further ahead isn't slowed down.

const MAX_EXCLUDED_STEMS = 60;
const MAX_STEM_CHARS = 300;

export interface SiblingBatch {
  batchIndex: number;
  stage: BatchStage;
  drafts: DraftSlot[];
  outcomes: SlotOutcome[];
}

/**
 * Stems of the valid, not dropped drafts in the mock's other unfinished batches. A finished
 * batch's accepted questions are saved, so they come from the questions table instead.
 */
export function inFlightStems(batches: SiblingBatch[], batchIndex: number): string[] {
  return batches
    .filter((batch) => batch.batchIndex !== batchIndex && batch.stage !== "done" && batch.stage !== "failed")
    .sort((a, b) => a.batchIndex - b.batchIndex)
    .flatMap((batch) => {
      const dropped = new Set(batch.outcomes.filter((outcome) => outcome.status === "dropped").map((outcome) => outcome.slot));
      return batch.drafts.flatMap((draft) => (draft.question && !dropped.has(draft.slot) ? [draft.question.prompt] : []));
    });
}

/**
 * The excluded stems, capped and shortened for prompts. The sample exam's come first (the
 * same in every call of an exam, so the prompt cache can reuse them), then this mock's
 * (saved, then in flight), then earlier mocks', so a long chain of mocks never pushes this
 * mock's own questions out of the list.
 */
export function excludedStemList(stems: { samples: string[]; saved: string[]; inFlight: string[]; earlierMocks: string[] }): string[] {
  const all = [...new Set([...stems.samples, ...stems.saved, ...stems.inFlight, ...stems.earlierMocks])];
  return all.slice(0, MAX_EXCLUDED_STEMS).map((stem) => (stem.length > MAX_STEM_CHARS ? `${stem.slice(0, MAX_STEM_CHARS)}…` : stem));
}
