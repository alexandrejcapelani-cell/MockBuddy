import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BlueprintSection } from "../schemas.ts";
import { allocateSections, batchOrdinals, buildPlan, type PlannableChunk, selectChunks } from "./plan.ts";

const section = (name: string, question_type: BlueprintSection["question_type"], proportion: number): BlueprintSection => ({
  name,
  question_type,
  proportion,
  marks_each: question_type === "mcq" ? 2 : 5,
  style_notes: "notes",
  observed_difficulty: "medium",
});

const chunk = (id: string, topicLabel: string, ordinal = 1, materialOrder = 0): PlannableChunk => ({
  id,
  topicLabel,
  ordinal,
  materialOrder,
});

describe("allocateSections", () => {
  test("10 questions at 0.6 MCQ / 0.4 short gives 6 and 4, in paper order", () => {
    const slots = allocateSections([section("A", "mcq", 0.6), section("B", "short", 0.4)], 10);
    assert.deepEqual(slots.map((s) => s.name), [...Array(6).fill("A"), ...Array(4).fill("B")]);
  });

  test("the rounding remainder goes to the largest section", () => {
    // 5 × (0.5, 0.3, 0.2) rounds to 3 + 2 + 1 = 6; the extra one comes off the largest.
    const slots = allocateSections([section("A", "mcq", 0.5), section("B", "short", 0.3), section("C", "numerical", 0.2)], 5);
    assert.deepEqual(slots.map((s) => s.name), ["A", "A", "B", "B", "C"]);
    // 20 × (0.45, 0.45, 0.1) rounds to 9 + 9 + 2 = 20 exactly.
    assert.equal(allocateSections([section("A", "mcq", 0.45), section("B", "short", 0.45), section("C", "numerical", 0.1)], 20).length, 20);
  });

  test("always returns exactly the requested count", () => {
    for (const total of [5, 10, 15, 20]) {
      const slots = allocateSections([section("A", "mcq", 0.34), section("B", "short", 0.33), section("C", "numerical", 0.33)], total);
      assert.equal(slots.length, total);
    }
  });
});

describe("selectChunks", () => {
  const chunks = [
    chunk("ovb1", "Omitted variable bias", 1),
    chunk("ovb2", "Omitted variable bias", 2),
    chunk("het1", "Heteroskedasticity", 1, 1),
    chunk("iv1", "Instrumental variables", 2, 1),
    chunk("iv2", "Instrumental variables", 3, 1),
    chunk("ols1", "OLS assumptions", 1, 2),
  ];

  test("consecutive picks come from different topics, covering every topic before repeating one", () => {
    const picks = selectChunks(chunks, 4, { seed: 0 });
    assert.equal(new Set(picks.map((p) => p.primary.topicLabel)).size, 4);
    for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i].primary.topicLabel, picks[i - 1].primary.topicLabel);
  });

  test("uses every chunk before reusing one, then repeats the sequence", () => {
    const picks = selectChunks(chunks, 8, { seed: 3 });
    assert.equal(new Set(picks.slice(0, 6).map((p) => p.primary.id)).size, 6);
    assert.equal(picks[6].primary.id, picks[0].primary.id);
  });

  test("a different seed draws a different slice", () => {
    const a = selectChunks(chunks, 3, { seed: 1 }).map((p) => p.primary.id);
    const b = selectChunks(chunks, 3, { seed: 2 }).map((p) => p.primary.id);
    assert.notDeepEqual(a, b);
  });

  test("avoided chunks come only after every fresh one", () => {
    const avoid = new Set(["ovb1", "het1", "iv1"]);
    const picks = selectChunks(chunks, 6, { seed: 0, avoid }).map((p) => p.primary.id);
    assert.deepEqual(new Set(picks.slice(0, 3)), new Set(["ovb2", "iv2", "ols1"]));
    assert.ok(picks.slice(3).every((id) => avoid.has(id)));
  });

  test("HARDER pairs each chunk with a second one, from the same topic when possible", () => {
    const picks = selectChunks(chunks, 6, { seed: 0, withSecondary: true });
    for (const { primary, secondary } of picks) {
      assert.ok(secondary);
      assert.notEqual(secondary.id, primary.id);
      const sameTopicExists = chunks.filter((c) => c.topicLabel === primary.topicLabel).length > 1;
      if (sameTopicExists) assert.equal(secondary.topicLabel, primary.topicLabel);
    }
  });
});

test("buildPlan assigns every slot a section, chunk and topic, and batches them by 5", () => {
  const plan = buildPlan({
    sections: [section("A", "mcq", 0.6), section("B", "short", 0.4)],
    chunks: [chunk("a", "Topic A"), chunk("b", "Topic B"), chunk("c", "Topic C")],
    questionCount: 20,
    harder: false,
    seed: 42,
  });
  assert.equal(plan.slots.length, 20);
  assert.deepEqual(plan.slots.map((s) => s.ordinal), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(plan.slots.every((s) => s.secondaryChunkId === null && s.replacesSlot === null));
  assert.equal(plan.slots.filter((s) => s.type === "mcq").length, 12);
  assert.deepEqual(batchOrdinals(plan.slots).map((b) => b.length), [5, 5, 5, 5]);
});
