// Splits extracted text into chunks of about TARGET_TOKENS with OVERLAP_TOKENS of overlap.
//
// Pages (or Markdown sections, or paragraphs) are the units. Headings are preferred break
// points: once a chunk holds MIN_SECTION_TOKENS, a new heading starts a new chunk. Otherwise
// consecutive units merge until the next one would overflow the target. Slides are sparse,
// so this gives chunks of a few slides on one sub-topic: fine-grained enough for distinct
// topic labels, never one tiny chunk per slide and never more than the target.

export const TARGET_TOKENS = 2_500;
export const OVERLAP_TOKENS = 300;
export const MIN_SECTION_TOKENS = 600;
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;
const MIN_SECTION_CHARS = MIN_SECTION_TOKENS * CHARS_PER_TOKEN;
const MAX_LABEL_LENGTH = 140;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface Unit {
  heading: string | null;
  text: string;
  /** 1-based PDF page numbers the text came from; empty for text and Markdown files. */
  pages: number[];
}

export interface ChunkDraft {
  /** 1-based position within the material. */
  ordinal: number;
  sectionLabel: string;
  content: string;
  tokenEstimate: number;
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first line of a page when it reads like a title. */
export function detectHeading(text: string): string | null {
  const first = text.split("\n").find((line) => line.trim() !== "")?.trim();
  if (!first) return null;
  const words = first.split(/\s+/);
  const looksLikeTitle =
    first.length >= 3 &&
    first.length <= 90 &&
    words.length <= 12 &&
    /\p{L}/u.test(first) &&
    !/[.,;!?]$/.test(first) &&
    !/^(page|slide)?\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(first);
  return looksLikeTitle ? first : null;
}

export function unitsFromPages(pages: string[]): Unit[] {
  return pages.flatMap((raw, index) => {
    const text = normalizeText(raw);
    return text ? [{ heading: detectHeading(text), text, pages: [index + 1] }] : [];
  });
}

export function unitsFromMarkdown(markdown: string): Unit[] {
  const text = normalizeText(markdown);
  const units: Unit[] = [];
  let heading: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) units.push({ heading, text: body, pages: [] });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (match) {
      flush();
      heading = match[1];
    }
    lines.push(line);
  }
  flush();
  return units;
}

export function unitsFromPlainText(plain: string): Unit[] {
  return normalizeText(plain)
    .split(/\n\n+/)
    .map((paragraph) => ({ heading: null, text: paragraph.trim(), pages: [] }))
    .filter((unit) => unit.text !== "");
}

export function chunkUnits(units: Unit[]): ChunkDraft[] {
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  for (const piece of units.flatMap(splitOversized)) {
    const pieceSize = piece.text.length + 2;
    const previousHeading = current.at(-1)?.heading ?? null;
    const startsNewSection = piece.heading !== null && piece.heading !== previousHeading;
    const full = size + pieceSize > TARGET_CHARS;
    if (current.length > 0 && (full || (startsNewSection && size >= MIN_SECTION_CHARS))) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(piece);
    size += pieceSize;
  }
  if (current.length > 0) groups.push(current);

  let previousBody = "";
  return groups.map((group, index) => {
    const body = group.map((unit) => unit.text).join("\n\n");
    const content = index === 0 ? body : `${overlapTail(previousBody)}\n\n${body}`;
    previousBody = body;
    return {
      ordinal: index + 1,
      sectionLabel: sectionLabel(group, index),
      content,
      tokenEstimate: estimateTokens(content),
    };
  });
}

/** Splits a unit longer than the target at paragraph, then sentence, then word boundaries. */
function splitOversized(unit: Unit): Unit[] {
  if (unit.text.length <= TARGET_CHARS) return [unit];
  const atoms = unit.text
    .split(/\n\n+/)
    .flatMap((paragraph) =>
      paragraph.length <= TARGET_CHARS ? [paragraph] : paragraph.split(/(?<=[.!?])\s+/),
    )
    .flatMap((sentence) => (sentence.length <= TARGET_CHARS ? [sentence] : hardSplit(sentence)));

  const pieces: string[] = [];
  let piece = "";
  for (const atom of atoms) {
    if (piece && piece.length + atom.length + 2 > TARGET_CHARS) {
      pieces.push(piece);
      piece = "";
    }
    piece = piece ? `${piece}\n\n${atom}` : atom;
  }
  if (piece) pieces.push(piece);
  return pieces.map((text) => ({ ...unit, text }));
}

function hardSplit(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > TARGET_CHARS) {
    const cut = rest.lastIndexOf(" ", TARGET_CHARS);
    const at = cut > TARGET_CHARS / 2 ? cut : TARGET_CHARS;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** The last ~OVERLAP_CHARS of the previous chunk, starting at a line, sentence or word boundary. */
function overlapTail(text: string): string {
  if (text.length <= OVERLAP_CHARS) return text;
  const window = text.slice(-OVERLAP_CHARS);
  const searchLimit = Math.floor(window.length * 0.4);
  const boundaries = [window.indexOf("\n"), window.search(/[.!?]\s/)].filter((i) => i >= 0 && i < searchLimit);
  if (boundaries.length > 0) return window.slice(Math.min(...boundaries) + 1).trimStart();
  const space = window.indexOf(" ");
  return (space >= 0 ? window.slice(space + 1) : window).trimStart();
}

function sectionLabel(group: Unit[], index: number): string {
  const pages = [...new Set(group.flatMap((unit) => unit.pages))].sort((a, b) => a - b);
  const where =
    pages.length === 0 ? `Part ${index + 1}` : pages[0] === pages.at(-1) ? `p. ${pages[0]}` : `pp. ${pages[0]}–${pages.at(-1)}`;
  const headings = [...new Set(group.flatMap((unit) => (unit.heading ? [unit.heading] : [])))];
  const shown = headings.slice(0, 3).join(" · ") + (headings.length > 3 ? " …" : "");
  const label = shown ? `${where} · ${shown}` : where;
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label;
}
