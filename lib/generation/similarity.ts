// The server-side word-overlap check: catches a new stem that repeats an existing one
// (the sample exam's questions, earlier exams in a regeneration chain, or other questions
// in this exam). No embeddings: 3-word shingles and the overlap coefficient.

/** Stems scoring at or above this are treated as duplicates. */
export const SIMILARITY_THRESHOLD = 0.6;

export function stemWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\\[a-z]+/g, (command) => ` ${command.slice(1)} `) // \hat{\beta} → "hat beta"
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

function shingles(words: string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) result.add(words.slice(i, i + 3).join(" "));
  return result;
}

/**
 * 0 to 1. Overlap coefficient of 3-word shingles (so a stem contained in a longer one
 * still scores high); Jaccard of the word sets for stems too short to have shingles.
 */
export function stemSimilarity(a: string, b: string): number {
  const wordsA = stemWords(a);
  const wordsB = stemWords(b);
  if (wordsA.length < 5 || wordsB.length < 5) {
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : [...setA].filter((word) => setB.has(word)).length / union;
  }
  const shinglesA = shingles(wordsA);
  const shinglesB = shingles(wordsB);
  const shared = [...shinglesA].filter((shingle) => shinglesB.has(shingle)).length;
  return shared / Math.min(shinglesA.size, shinglesB.size);
}

/** The most similar of `others` if it reaches the threshold, else null. */
export function findNearDuplicate(stem: string, others: string[]): { text: string; score: number } | null {
  let best: { text: string; score: number } | null = null;
  for (const other of others) {
    const score = stemSimilarity(stem, other);
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { text: other, score };
  }
  return best;
}
