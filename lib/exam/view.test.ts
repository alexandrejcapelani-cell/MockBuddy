import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDealt, questionState, toQuestionView } from "./view.ts";

const question = {
  id: "q1",
  examId: "e1",
  ordinal: 1,
  type: "mcq" as const,
  prompt: "Which property does OLS lose under heteroskedasticity?",
  marks: 2,
  options: ["Unbiasedness", "Being BLUE", "Consistency", "Linearity"],
  correctOption: 1,
  optionExplanations: [{ index: 1, is_correct: true, explanation: "SECRET-EXPLANATION Gauss-Markov needs MLR.5." }],
  correctExplanation: "SECRET-WHY",
  expectedAnswer: null,
  rubric: null,
  numericAnswer: null,
  tolerance: null,
  unit: null,
  workedSolution: "SECRET-SOLUTION",
  sourceChunkId: "c1",
  sourceExcerpt: "SECRET-EXCERPT",
  topicLabel: "Homoskedasticity",
  difficulty: "medium" as const,
};

test("an unanswered question carries no answer key or explanation", () => {
  const view = toQuestionView(question, null, "pp. 6–7");
  assert.equal(view.reveal, null);
  assert.equal(questionState(view), "unanswered");
  const serialized = JSON.stringify(view);
  for (const secret of ["SECRET", '"correctOption"', '"correct_option"']) assert.ok(!serialized.includes(secret), secret);
});

test("an answered question reveals the key, every explanation and its source", () => {
  const answer = {
    id: "a1",
    examId: "e1",
    questionId: "q1",
    response: "0",
    isCorrect: false,
    awardedMarks: 0,
    feedback: null,
    rubricMarks: null,
    answeredAt: new Date(),
  };
  const view = toQuestionView(question, answer, "pp. 6–7");
  assert.equal(view.reveal?.correctOption, 1);
  assert.equal(view.reveal?.sourceSection, "pp. 6–7");
  assert.equal(questionState(view), "wrong");
});

test("mergeDealt adds streamed questions in paper order and keeps answers the page already has", () => {
  const answer = { id: "a1", examId: "e1", questionId: "q1", response: "1", isCorrect: true, awardedMarks: 2, feedback: null, rubricMarks: null, answeredAt: new Date() };
  const answered = toQuestionView(question, answer, null);
  const stale = toQuestionView(question, null, null);
  const later = toQuestionView({ ...question, id: "q7", ordinal: 7 }, null, null);
  const early = toQuestionView({ ...question, id: "q3", ordinal: 3 }, null, null);
  const merged = mergeDealt([answered, later], [{ ...stale, ordinal: 1 }, early, later]);
  assert.deepEqual(merged.map((view) => view.id), ["q1", "q3", "q7"]);
  assert.ok(merged[0].answer, "the answer saved on this page survives a list read before it");
});
