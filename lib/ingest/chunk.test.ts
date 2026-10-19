import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  chunkUnits,
  detectHeading,
  estimateTokens,
  TARGET_TOKENS,
  unitsFromMarkdown,
  unitsFromPages,
  unitsFromPlainText,
} from "./chunk.ts";

const sentence = (n: number) => `Sentence ${n} explains how the estimator behaves when the regressor is endogenous.`;
const slide = (title: string, sentences: number, from = 0) =>
  `${title}\n${Array.from({ length: sentences }, (_, i) => sentence(from + i)).join(" ")}`;

describe("detectHeading", () => {
  test("accepts a slide title", () => assert.equal(detectHeading("Omitted variable bias\nWhen a relevant X is left out…"), "Omitted variable bias"));
  test("rejects a sentence", () => assert.equal(detectHeading("This slide ends with a full stop.\nmore"), null));
  test("rejects a page number", () => assert.equal(detectHeading("12\nbody"), null));
  test("rejects 'Slide 3 of 40'", () => assert.equal(detectHeading("Slide 3 of 40\nbody"), null));
});

describe("chunkUnits on slide decks", () => {
  test("short slides merge into one chunk labelled with the page range and titles", () => {
    const chunks = chunkUnits(unitsFromPages([slide("OLS assumptions", 3), slide("Gauss–Markov theorem", 3), slide("BLUE", 2)]));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].ordinal, 1);
    assert.equal(chunks[0].sectionLabel, "pp. 1–3 · OLS assumptions · Gauss–Markov theorem · BLUE");
  });

  test("a long deck becomes several chunks near the target size, keeping all text in order", () => {
    const pages = Array.from({ length: 60 }, (_, i) => slide(`Topic ${i}`, 8, i * 8));
    const chunks = chunkUnits(unitsFromPages(pages));
    assert.ok(chunks.length > 3, `expected several chunks, got ${chunks.length}`);
    for (const chunk of chunks) {
      assert.ok(chunk.tokenEstimate <= TARGET_TOKENS + 350, `chunk ${chunk.ordinal} has ${chunk.tokenEstimate} tokens`);
    }
    const all = chunks.map((c) => c.content).join("\n");
    let last = -1;
    for (let n = 0; n < 480; n += 37) {
      const at = all.indexOf(sentence(n));
      assert.ok(at > last, `sentence ${n} missing or out of order`);
      last = at;
    }
    assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i + 1));
  });

  test("each chunk after the first starts with the end of the previous one", () => {
    const pages = Array.from({ length: 30 }, (_, i) => slide(`Topic ${i}`, 10, i * 10));
    const chunks = chunkUnits(unitsFromPages(pages));
    assert.ok(chunks.length >= 2);
    const firstBody = chunks[0].content;
    const overlap = chunks[1].content.slice(0, 200);
    assert.ok(firstBody.includes(overlap.slice(0, 120)), "chunk 2 should open with text from the end of chunk 1");
    const overlapTokens = estimateTokens(chunks[1].content) - estimateTokens(chunks[1].content.slice(1200));
    assert.ok(overlapTokens <= 320);
  });

  test("a sparse deck splits at slide titles once a chunk holds ~600 tokens", () => {
    // 40 slides of 3 sentences: about 70 tokens each, 2,800 tokens in all. Merging to the
    // 2,500-token target would give 2 chunks; breaking at titles after ~600 gives 4.
    const pages = Array.from({ length: 40 }, (_, i) => slide(`Topic ${i}`, 3, i * 3));
    const chunks = chunkUnits(unitsFromPages(pages));
    assert.ok(chunks.length >= 4, `expected at least 4 chunks, got ${chunks.length}`);
    for (const chunk of chunks.slice(0, -1)) {
      assert.ok(chunk.tokenEstimate >= 600, `chunk ${chunk.ordinal} has only ${chunk.tokenEstimate} tokens`);
    }
  });

  test("a single oversized page is split", () => {
    const chunks = chunkUnits(unitsFromPages([slide("Long derivation", 400)]));
    assert.ok(chunks.length >= 3);
    for (const chunk of chunks) assert.ok(chunk.tokenEstimate <= TARGET_TOKENS + 350);
    assert.ok(chunks.every((c) => c.sectionLabel === "p. 1 · Long derivation"));
  });

  test("empty pages are skipped", () => {
    const chunks = chunkUnits(unitsFromPages(["", "   ", slide("Instrumental variables", 2)]));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].sectionLabel, "p. 3 · Instrumental variables");
  });
});

describe("Markdown and plain text", () => {
  test("Markdown headings become section headings, and long sections break at a heading", () => {
    const body = (from: number) => Array.from({ length: 70 }, (_, i) => sentence(from + i)).join(" ");
    const md = `# Heteroskedasticity\n${body(0)}\n\n## Robust standard errors\n${body(100)}\n\n## Weighted least squares\n${body(200)}`;
    const chunks = chunkUnits(unitsFromMarkdown(md));
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].sectionLabel.startsWith("Part 1 · Heteroskedasticity"));
    assert.ok(chunks.some((c) => c.sectionLabel.includes("Weighted least squares")));
  });

  test("plain text paragraphs merge", () => {
    const chunks = chunkUnits(unitsFromPlainText(`${sentence(1)}\n\n${sentence(2)}\n\n\n${sentence(3)}`));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].sectionLabel, "Part 1");
    assert.ok(chunks[0].content.includes(sentence(3)));
  });
});
