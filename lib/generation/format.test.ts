import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlueprintSection } from "../schemas.ts";
import { sampleMix, sectionsForFormat } from "./format.ts";
import { allocateSections } from "./plan.ts";

const section = (name: string, question_type: BlueprintSection["question_type"], proportion: number): BlueprintSection => ({
  name,
  question_type,
  proportion,
  marks_each: question_type === "mcq" ? 2 : 5,
  style_notes: `${name} style`,
  observed_difficulty: "medium",
});
const sample = [section("A", "mcq", 0.5), section("B", "short", 0.3), section("C", "numerical", 0.2)];
const types = (sections: BlueprintSection[], total: number) => allocateSections(sections, total).map((s) => s.question_type);

test("mixed keeps the sample's own mix", () => {
  assert.deepEqual(sectionsForFormat(sample, "mixed"), sample);
  const mixed = types(sectionsForFormat(sample, "mixed"), 10);
  assert.equal(mixed.filter((t) => t === "mcq").length, 5);
});

test("MCQ only plans every slot from the sample's multiple-choice sections", () => {
  assert.ok(types(sectionsForFormat(sample, "mcq"), 15).every((t) => t === "mcq"));
  assert.equal(sectionsForFormat(sample, "mcq")[0].style_notes, "A style");
});

test("open-ended only keeps short answers and calculations, in the sample's proportions", () => {
  const open = types(sectionsForFormat(sample, "open"), 10);
  assert.ok(open.every((t) => t !== "mcq"));
  assert.equal(open.filter((t) => t === "short").length, 6);
  assert.equal(open.filter((t) => t === "numerical").length, 4);
});

test("a format the sample doesn't have gets one stand-in section in the paper's style", () => {
  const openOnly = [section("Essays", "short", 1)];
  const [mcq] = sectionsForFormat(openOnly, "mcq");
  assert.equal(mcq.question_type, "mcq");
  assert.match(mcq.style_notes, /four options/);
  const mcqOnly = [section("Quick", "mcq", 1)];
  assert.equal(sectionsForFormat(mcqOnly, "open")[0].question_type, "short");
});

test("sampleMix reports the multiple-choice share", () => {
  assert.deepEqual(sampleMix(sample), { mcqShare: 0.5, hasMcq: true, hasOpen: true });
  assert.equal(sampleMix([section("Essays", "short", 1)]).hasMcq, false);
});
