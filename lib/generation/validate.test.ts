import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { GeneratedQuestion } from "../schemas.ts";
import type { PlanSlot } from "./types.ts";
import { normalizeQuestion, questionIssues } from "./validate.ts";

const chunk = `Homoskedasticity (MLR.5)
MLR.5 states that Var(u | x1, ..., xk) = sigma^2: the error variance does not depend on the regressors.
Homoskedasticity is NOT needed for unbiasedness. It is needed for the usual OLS variance formula and for the Gauss-Markov theorem.`;

const slot = (overrides: Partial<PlanSlot> = {}): PlanSlot => ({
  ordinal: 3,
  type: "mcq",
  sectionName: "Section A",
  marks: 2,
  styleNotes: "Four options.",
  observedDifficulty: "medium",
  chunkId: "c1",
  secondaryChunkId: null,
  topicLabel: "Homoskedasticity",
  replacesSlot: null,
  ...overrides,
});

const mcq = (overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  type: "mcq",
  prompt: String.raw`A researcher finds that \(\text{Var}(u \mid x)\) rises with \(x\). Which property of OLS is lost?`,
  marks: 2,
  options: ["Unbiasedness", "Being BLUE", "Consistency", "Linearity in parameters"],
  correct_option: 1,
  option_explanations: [
    { index: 0, is_correct: false, explanation: "This confuses unbiasedness with efficiency: unbiasedness needs only MLR.1 to MLR.4, not constant error variance." },
    { index: 1, is_correct: true, explanation: "Gauss-Markov needs MLR.5, so under heteroskedasticity OLS is still unbiased but no longer has the smallest variance among linear unbiased estimators." },
    { index: 2, is_correct: false, explanation: "Consistency, like unbiasedness, rests on the zero conditional mean assumption and survives a non-constant error variance." },
    { index: 3, is_correct: false, explanation: "Linearity is a feature of the model specification (MLR.1) and has nothing to do with how the error variance behaves." },
  ],
  correct_explanation: "Homoskedasticity is not needed for unbiasedness, but the Gauss-Markov theorem requires it, so OLS stops being BLUE.",
  expected_answer: null,
  rubric: null,
  numeric_answer: null,
  tolerance: null,
  unit: null,
  worked_solution: "MLR.5 fails, so the Gauss-Markov theorem no longer applies; MLR.1 to MLR.4 still hold, so OLS stays unbiased.",
  source_excerpt: "Homoskedasticity is NOT needed for unbiasedness.",
  topic_label: "Whatever the model wrote",
  difficulty: "medium",
  ...overrides,
});

const sources = { primary: chunk, secondary: null };

describe("questionIssues", () => {
  test("a well-formed MCQ has no issues", () => assert.deepEqual(questionIssues(mcq(), slot(), sources), []));

  test("an explanation that only restates its option is rejected", () => {
    const explanations = mcq().option_explanations!.map((e) => (e.index === 2 ? { ...e, explanation: "Consistency is incorrect." } : e));
    const issues = questionIssues(mcq({ option_explanations: explanations }), slot(), sources);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /option 2 only restates it; name the specific misconception/);
  });

  test("every option needs exactly one explanation, flagged correct only for the key", () => {
    const explanations = mcq().option_explanations!.slice(0, 3).map((e) => ({ ...e, is_correct: e.index === 0 }));
    const issues = questionIssues(mcq({ option_explanations: explanations }), slot(), sources).join("\n");
    assert.match(issues, /one entry per option \(4\); it has 3/);
    assert.match(issues, /option 3 needs exactly one entry/);
    assert.match(issues, /option_explanations\[0\]\.is_correct must be false/);
  });

  test("an invented source excerpt is rejected", () => {
    const issues = questionIssues(mcq({ source_excerpt: "Heteroskedasticity always biases the OLS slope estimates." }), slot(), sources);
    assert.match(issues[0], /does not appear in the slot's chunk/);
  });

  test("$ math and broken LaTeX are rejected", () => {
    const issues = questionIssues(mcq({ prompt: String.raw`If $\hat\beta$ is \(\frac{1}{\) what follows here?` }), slot(), sources);
    assert.ok(issues.some((i) => /uses \$ for math/.test(i)));
    assert.ok(issues.some((i) => /doesn't render/.test(i)));
  });

  test("short answers need rubric marks that add up to the question's marks", () => {
    const short: GeneratedQuestion = {
      ...mcq(),
      type: "short",
      options: null,
      correct_option: null,
      option_explanations: null,
      expected_answer: "OLS stays unbiased because unbiasedness needs only MLR.1 to MLR.4, but it is no longer BLUE.",
      rubric: [
        { point: "States OLS remains unbiased", marks: 2 },
        { point: "States OLS is no longer BLUE", marks: 2 },
      ],
    };
    const issues = questionIssues(short, slot({ type: "short", marks: 5 }), sources);
    assert.deepEqual(issues, ["slot 3: rubric marks add up to 4; they must add up to the question's 5 marks."]);
  });

  test("numerical questions need a finite answer and a sensible tolerance", () => {
    const numerical: GeneratedQuestion = { ...mcq(), type: "numerical", options: null, correct_option: null, option_explanations: null, numeric_answer: 2.4, tolerance: 5 };
    const issues = questionIssues(numerical, slot({ type: "numerical", marks: 5 }), sources);
    assert.match(issues.join(" "), /tolerance 5 is as large as the answer/);
  });
});

test("normalizeQuestion takes marks and topic from the slot and nulls fields of other types", () => {
  const normalized = normalizeQuestion(mcq({ marks: 9, expected_answer: "stray", numeric_answer: 3 }), slot());
  assert.equal(normalized.marks, 2);
  assert.equal(normalized.topic_label, "Homoskedasticity");
  assert.equal(normalized.expected_answer, null);
  assert.equal(normalized.numeric_answer, null);
});
