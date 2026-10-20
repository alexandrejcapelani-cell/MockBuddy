import type { BlueprintSection } from "../schemas.ts";
import type { ExamPlan, PlanSlot } from "./types.ts";

// Slot planning (spec section 7, "Chunk selection" and section 8 proportions).

export const BATCH_SIZE = 5;

export interface PlannableChunk {
  id: string;
  topicLabel: string;
  /** Position of the chunk's material among the student's files (upload order). */
  materialOrder: number;
  ordinal: number;
}

/**
 * The section of each slot, in paper order. Counts are proportion × total rounded, with
 * any remainder given to (or taken from) the largest section.
 */
export function allocateSections(sections: BlueprintSection[], total: number): BlueprintSection[] {
  if (sections.length === 0) throw new Error("The blueprint has no sections.");
  const sum = sections.reduce((acc, section) => acc + section.proportion, 0);
  const weights = sections.map((section) => (sum > 0 ? section.proportion / sum : 1 / sections.length));
  const counts = weights.map((weight) => Math.round(weight * total));
  const byWeight = weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a] || a - b);

  let diff = total - counts.reduce((acc, n) => acc + n, 0);
  while (diff > 0) {
    counts[byWeight[0]]++;
    diff--;
  }
  while (diff < 0) {
    const from = byWeight.find((i) => counts[i] > 0);
    if (from === undefined) break;
    counts[from]--;
    diff++;
  }
  return sections.flatMap((section, i) => Array.from({ length: counts[i] }, () => section));
}

export interface ChunkPick {
  primary: PlannableChunk;
  secondary: PlannableChunk | null;
}

/**
 * Picks `count` chunks: grouped by topic label, then round-robin across topics so that
 * consecutive picks come from different parts of the material. The seed offsets the
 * starting topic and the order within each topic, so the next mock draws a different
 * slice. Chunks in `avoid` (already used) only come after every fresh chunk; if there are
 * fewer chunks than needed, the sequence repeats.
 */
export function selectChunks(
  chunks: PlannableChunk[],
  count: number,
  options: { seed: number; avoid?: ReadonlySet<string>; withSecondary?: boolean },
): ChunkPick[] {
  if (chunks.length === 0) throw new Error("There are no chunks to plan from.");
  const avoid = options.avoid ?? new Set<string>();
  const groups = groupByTopic(chunks, options.seed);

  const fresh = roundRobin(groups.map((group) => group.filter((chunk) => !avoid.has(chunk.id))), options.seed);
  const used = roundRobin(groups.map((group) => group.filter((chunk) => avoid.has(chunk.id))), options.seed);
  const sequence = [...fresh, ...used];

  const picks: ChunkPick[] = [];
  for (let i = 0; i < count; i++) {
    const primary = sequence[i % sequence.length];
    picks.push({ primary, secondary: options.withSecondary ? secondaryFor(primary, groups) : null });
  }
  return picks;
}

function groupByTopic(chunks: PlannableChunk[], seed: number): PlannableChunk[][] {
  const byTopic = new Map<string, PlannableChunk[]>();
  for (const chunk of chunks) {
    const group = byTopic.get(chunk.topicLabel) ?? [];
    group.push(chunk);
    byTopic.set(chunk.topicLabel, group);
  }
  return [...byTopic.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([, group], topicIndex) => {
      const ordered = [...group].sort((a, b) => a.materialOrder - b.materialOrder || a.ordinal - b.ordinal);
      return rotate(ordered, seed + topicIndex);
    });
}

function roundRobin(groups: PlannableChunk[][], seed: number): PlannableChunk[] {
  const nonEmpty = groups.filter((group) => group.length > 0);
  if (nonEmpty.length === 0) return [];
  const start = seed % nonEmpty.length;
  const longest = Math.max(...nonEmpty.map((group) => group.length));
  const sequence: PlannableChunk[] = [];
  for (let round = 0; round < longest; round++) {
    for (let k = 0; k < nonEmpty.length; k++) {
      const chunk = nonEmpty[(start + k) % nonEmpty.length][round];
      if (chunk) sequence.push(chunk);
    }
  }
  return sequence;
}

/** Another chunk from the same topic if there is one, else the first chunk of the next topic. */
function secondaryFor(primary: PlannableChunk, groups: PlannableChunk[][]): PlannableChunk | null {
  const topicIndex = groups.findIndex((group) => group.some((chunk) => chunk.id === primary.id));
  const group = groups[topicIndex];
  if (group.length > 1) {
    const at = group.findIndex((chunk) => chunk.id === primary.id);
    return group[(at + 1) % group.length];
  }
  if (groups.length > 1) return groups[(topicIndex + 1) % groups.length][0];
  return null;
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const shift = by % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

export function buildPlan(input: {
  sections: BlueprintSection[];
  chunks: PlannableChunk[];
  questionCount: number;
  harder: boolean;
  seed: number;
  avoidChunkIds?: ReadonlySet<string>;
}): ExamPlan {
  const sections = allocateSections(input.sections, input.questionCount);
  const picks = selectChunks(input.chunks, input.questionCount, {
    seed: input.seed,
    avoid: input.avoidChunkIds,
    withSecondary: input.harder,
  });
  return {
    version: 1,
    slots: sections.map((section, i) => slotFor(i + 1, section, picks[i], null)),
  };
}

export function slotFor(ordinal: number, section: BlueprintSection, pick: ChunkPick, replacesSlot: number | null): PlanSlot {
  return {
    ordinal,
    type: section.question_type,
    sectionName: section.name,
    marks: section.marks_each,
    styleNotes: section.style_notes,
    observedDifficulty: section.observed_difficulty,
    chunkId: pick.primary.id,
    secondaryChunkId: pick.secondary?.id ?? null,
    topicLabel: pick.primary.topicLabel,
    replacesSlot,
  };
}

/**
 * Where each slot's question sits in the paper, by slot ordinal: an initial slot keeps its
 * own place and a top-up takes the place of the slot it replaces (following replacements of
 * replacements). Questions stream in by these places, so one doesn't move when a
 * replacement lands; finalizing numbers the questions in this order.
 */
export function paperPositions(slots: PlanSlot[]): Map<number, number> {
  const byOrdinal = new Map(slots.map((slot) => [slot.ordinal, slot]));
  const positions = new Map<number, number>();
  for (const slot of slots) {
    let at = slot;
    for (let hops = 0; at.replacesSlot !== null && byOrdinal.has(at.replacesSlot) && hops < slots.length; hops++) {
      at = byOrdinal.get(at.replacesSlot)!;
    }
    positions.set(slot.ordinal, at.ordinal);
  }
  return positions;
}

/** Slot ordinals grouped into batches of BATCH_SIZE, in order. */
export function batchOrdinals(slots: PlanSlot[]): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < slots.length; i += BATCH_SIZE) {
    batches.push(slots.slice(i, i + BATCH_SIZE).map((slot) => slot.ordinal));
  }
  return batches;
}
