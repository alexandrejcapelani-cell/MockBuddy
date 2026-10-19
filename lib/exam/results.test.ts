import assert from "node:assert/strict";
import { test } from "node:test";
import { computeResults } from "./results.ts";
import type { QuestionView } from "./view.ts";

const q = (topic: string, marks: number, awarded: number | null, isCorrect = awarded === marks): QuestionView => ({
  id: `${topic}-${Math.random()}`,
  ordinal: 1,
  type: "mcq",
  prompt: "p",
  marks,
  topicLabel: topic,
  options: null,
  unit: null,
  answer: awarded === null ? null : { response: "0", isCorrect, awardedMarks: awarded, feedback: null, rubricMarks: null },
  reveal: null,
});

test("scores marks over the whole exam, counting unanswered questions as zero", () => {
  const results = computeResults([q("OVB", 2, 2), q("OVB", 2, 0), q("IV", 5, 3, true), q("IV", 5, null)]);
  assert.equal(results.totalMarks, 14);
  assert.equal(results.awardedMarks, 5);
  assert.equal(Math.round(results.percent), 36);
  assert.deepEqual([results.answered, results.correct, results.total], [3, 2, 4]);
});

test("flags the strongest topic HOT and the weakest COLD", () => {
  const { topics } = computeResults([q("OVB", 2, 2), q("IV", 2, 0), q("Het", 2, 2), q("Het", 2, 0)]);
  const flags = Object.fromEntries(topics.map((t) => [t.topic, t.flag]));
  assert.deepEqual(flags, { OVB: "HOT", IV: "COLD", Het: null });
});

test("ties share the flag", () => {
  const { topics } = computeResults([q("A", 2, 2), q("B", 2, 2), q("C", 2, 0)]);
  assert.deepEqual(topics.map((t) => t.flag), ["HOT", "HOT", "COLD"]);
});

test("no flags without a spread, and unanswered topics have no accuracy", () => {
  assert.ok(computeResults([q("A", 2, 2), q("B", 2, 2)]).topics.every((t) => t.flag === null));
  assert.ok(computeResults([q("A", 2, 1)]).topics.every((t) => t.flag === null));
  const unanswered = computeResults([q("A", 2, 2), q("B", 2, null)]).topics.find((t) => t.topic === "B")!;
  assert.equal(unanswered.accuracy, null);
  assert.equal(unanswered.flag, null);
});

test("accuracy uses partial marks", () => {
  const [row] = computeResults([q("A", 5, 2.5, true), q("A", 5, 5)]).topics;
  assert.equal(row.accuracy, 0.75);
  assert.equal(row.correct, 2);
});
