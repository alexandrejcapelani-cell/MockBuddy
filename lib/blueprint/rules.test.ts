import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Blueprint } from "../schemas.ts";
import { blueprintIssues, isVerbatim, toStoredBlueprint } from "./rules.ts";

const paper = `SECTION A - Multiple choice (2 marks each)
1. Adding an irrelevant regressor to a multiple regression will
(a) always increase the adjusted R-squared.
(b) never decrease the R-squared.
(c) bias the coefficients on the other regressors.
(d) reduce the variance of the other slope estimates.
SECTION B
8. In a simple IV regression, the sample covariance between the instrument z and y is 0.84 and the sample covariance between z and x is 0.35. Compute the IV estimate of the slope coefficient, to two decimal places.`;

const mcq = `1. Adding an irrelevant regressor to a multiple regression will (a) always increase the adjusted R-squared. (b) never decrease the R-squared. (c) bias the coefficients on the other regressors. (d) reduce the variance of the other slope estimates.`;
const numerical = `8. In a simple IV regression, the sample covariance between the instrument z and y is 0.84 and the sample covariance between z and x is 0.35. Compute the IV estimate of the slope coefficient, to two decimal places.`;

const blueprint = (overrides: Partial<Blueprint> = {}): Blueprint => ({
  duration_minutes: 90,
  instructions_style: "Answer ALL questions.",
  tone_notes:
    "Stems are impersonal and often open with a short scenario; MCQ stems run 15 to 35 words and end in an incomplete sentence; options are parallel full sentences labelled (a) to (d).",
  sections: [
    { name: "Section A", question_type: "mcq", proportion: 0.6, marks_each: 2, style_notes: "Four options, conceptual checks on OLS assumptions.", observed_difficulty: "medium" },
    { name: "Section B", question_type: "numerical", proportion: 0.4, marks_each: 5, style_notes: "Compute a single estimate from given sample moments.", observed_difficulty: "medium" },
  ],
  sample_questions: [
    { type: "mcq", verbatim_text: mcq },
    { type: "numerical", verbatim_text: numerical },
  ],
  ...overrides,
});

describe("isVerbatim", () => {
  test("matches across re-joined line breaks", () => assert.ok(isVerbatim(mcq, paper)));
  test("tolerates typographic quotes and dashes", () =>
    assert.ok(isVerbatim("SECTION A – Multiple choice (2 marks each)", paper)));
  test("rejects a paraphrase", () =>
    assert.ok(!isVerbatim("1. Including an irrelevant variable in a regression will always raise adjusted R-squared.", paper)));
});

describe("blueprintIssues", () => {
  test("a faithful blueprint has no issues", () => assert.deepEqual(blueprintIssues(blueprint(), paper), []));

  test("flags an invented sample question", () => {
    const issues = blueprintIssues(
      blueprint({ sample_questions: [{ type: "mcq", verbatim_text: "1. Which estimator is BLUE under heteroskedasticity? (a) OLS (b) WLS" }, { type: "numerical", verbatim_text: numerical }] }),
      paper,
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0], /not copied verbatim/);
  });

  test("flags proportions that don't sum to 1 and an uncovered question type", () => {
    const issues = blueprintIssues(
      blueprint({
        sections: [
          { name: "A", question_type: "mcq", proportion: 0.5, marks_each: 2, style_notes: "Four options on OLS assumptions.", observed_difficulty: "easy" },
          { name: "B", question_type: "short", proportion: 0.2, marks_each: 5, style_notes: "Explain a concept in a few lines.", observed_difficulty: "medium" },
        ],
        sample_questions: [{ type: "mcq", verbatim_text: mcq }],
      }),
      paper,
    );
    assert.ok(issues.some((issue) => /sum to 0.70/.test(issue)));
    assert.ok(issues.some((issue) => /no sample question has type "short"/.test(issue)));
  });
});

test("toStoredBlueprint rescales proportions and splits off the samples", () => {
  const { spec, sampleQuestions } = toStoredBlueprint(
    blueprint({
      sections: [
        { name: "A", question_type: "mcq", proportion: 0.66, marks_each: 2, style_notes: "Four options on OLS.", observed_difficulty: "medium" },
        { name: "B", question_type: "numerical", proportion: 0.33, marks_each: 5, style_notes: "Compute one estimate.", observed_difficulty: "medium" },
      ],
    }),
  );
  assert.equal(spec.sections.reduce((sum, s) => sum + s.proportion, 0), 1);
  assert.equal(sampleQuestions.length, 2);
  assert.ok(!("sample_questions" in spec));
});
