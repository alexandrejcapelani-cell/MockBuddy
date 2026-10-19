import type { TopicLabels } from "../schemas.ts";

// Rules and prompt for topic labels: the short names that spin on the reels, group the
// round-robin chunk rotation and head the per-topic score table.

/** Label for non-teaching chunks (title slides, logistics, reading lists). Never used for questions. */
export const ADMIN_TOPIC = "Course logistics";

/** Chunks per labelling call. */
export const LABEL_BATCH_SIZE = 20;

/** Characters of each chunk shown to the labeller; the opening is enough to name the topic. */
export const LABEL_EXCERPT_CHARS = 4_000;

const MAX_LABEL_LENGTH = 60;
const MAX_LABEL_WORDS = 6;
const STRUCTURAL_PREFIX = /^(chapter|lecture|part|section|week|unit|module|slides?|topic|session|class|lesson)\b/i;
const STRUCTURAL_WHOLE = /^(introduction|intro|summary|overview|conclusions?|exercises?|appendix|recap|review|questions|outline|agenda|contents)$/i;

export function normalizeTopicLabel(label: string): string {
  const cleaned = label.trim().replace(/\s+/g, " ").replace(/[.;:,!]+$/, "");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Problems with a labelling response, worded for the model to fix. Empty means valid. */
export function topicLabelIssues(response: TopicLabels, expectedIndexes: number[]): string[] {
  const issues: string[] = [];
  const expected = new Set(expectedIndexes);
  const seen = new Set<number>();
  for (const { index, topic_label } of response.labels) {
    if (!expected.has(index)) issues.push(`index ${index} is not one of the chunks you were given.`);
    if (seen.has(index)) issues.push(`index ${index} is labelled more than once.`);
    seen.add(index);

    const label = normalizeTopicLabel(topic_label);
    const words = label.split(" ").filter(Boolean).length;
    if (label === "") issues.push(`index ${index}: the label is empty.`);
    else if (label.length > MAX_LABEL_LENGTH || words > MAX_LABEL_WORDS) {
      issues.push(`index ${index}: "${label}" is too long; use 2 to 5 words.`);
    } else if (STRUCTURAL_PREFIX.test(label) || STRUCTURAL_WHOLE.test(label)) {
      issues.push(`index ${index}: "${label}" describes the document's structure; name the concept taught instead.`);
    }
  }
  for (const index of expected) if (!seen.has(index)) issues.push(`index ${index} has no label.`);
  return issues;
}

export interface ChunkForLabelling {
  index: number;
  sectionLabel: string;
  content: string;
}

export const TOPIC_LABEL_SYSTEM = `You label chunks of a student's course material with the topic each chunk teaches. The labels are shown on slot machine reels and in a per-topic score table, so they must be short and human-readable.

Rules for every label:
- 2 to 5 words naming the concept taught, for example "Omitted variable bias", "Heteroskedasticity-robust errors", "Instrumental variables".
- Sentence case, no numbering, no trailing punctuation.
- Never describe the document's structure: no "Chapter 4", "Lecture 3 part 2", "Introduction", "Summary" or "Exercises".
- When a chunk mainly teaches a topic already in the existing labels, reuse that label exactly, character for character.
- Chunks about the same topic get the same label. Different topics get different labels.
- A chunk that teaches nothing examinable (title slide, course logistics, reading list, contact details) gets the label "${ADMIN_TOPIC}".

Reply with a JSON object only: no prose, no code fences.`;

export function topicLabelPrompt(chunks: ChunkForLabelling[], existingLabels: string[], schema: string): string {
  const existing = existingLabels.length > 0 ? existingLabels.map((label) => `- ${label}`).join("\n") : "(none yet)";
  const body = chunks
    .map(
      (chunk) =>
        `<chunk index="${chunk.index}" section="${escapeAttribute(chunk.sectionLabel)}">\n${chunk.content.slice(0, LABEL_EXCERPT_CHARS)}\n</chunk>`,
    )
    .join("\n\n");
  return `<existing_labels>\n${existing}\n</existing_labels>\n\n<chunks>\n${body}\n</chunks>\n\nLabel every chunk: one entry per chunk index. The JSON must match this schema:\n${schema}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
