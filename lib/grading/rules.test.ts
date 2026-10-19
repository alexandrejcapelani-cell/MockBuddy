import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseNumericResponse, shortGradeIssues, shortIsCorrect, totalAwarded, withinTolerance } from "./rules.ts";

describe("parseNumericResponse", () => {
  const cases: [string, number[] | null][] = [
    ["2.4", [2.4]],
    ["2.40", [2.4]],
    ["  2,4 ", [2.4]],
    ["−2.4", [-2.4]],
    ["-0.62", [-0.62]],
    ["1,234.5", [1234.5]],
    ["1.234,5", [1234.5]],
    ["1,234", [1234, 1.234]],
    ["0,620", [0.62]],
    ["0,62", [0.62]],
    ["1,234,567", [1234567]],
    ["$2.40", [2.4]],
    ["24%", [24]],
    ["2.4 units", [2.4]],
    ["≈ 2.4", [2.4]],
    ["about 2.4", [2.4]],
    ["1e-3", [0.001]],
    ["", null],
    ["two point four", null],
    ["2.4 or 2.5", null],
    ["b1 = 2.4", null],
    ["1.2.3", null],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => assert.deepEqual(parseNumericResponse(input), expected));
  }
});

test("withinTolerance includes the boundary", () => {
  assert.ok(withinTolerance(2.395, 2.4, 0.005));
  assert.ok(withinTolerance(2.405, 2.4, 0.005));
  assert.ok(!withinTolerance(2.41, 2.4, 0.005));
  assert.ok(withinTolerance(3, 3, 0));
});

describe("short-answer marking", () => {
  const rubric = [
    { point: "Says multicollinearity does not bias OLS", marks: 2 },
    { point: "Links it to R_j^2 in the variance formula", marks: 2 },
    { point: "Concludes the estimates are imprecise", marks: 1 },
  ];
  const grade = (awarded: number[], feedback = "Good answer that names the right formula.") => ({
    points: awarded.map((a, index) => ({ index, awarded: a, reason: "present" })),
    feedback,
  });

  test("a complete marking has no issues and totals to half marks", () => {
    assert.deepEqual(shortGradeIssues(grade([2, 1.5, 1]), rubric), []);
    assert.equal(totalAwarded(grade([2, 1.5, 1])), 4.5);
  });

  test("flags missing points, out-of-range marks and empty feedback", () => {
    const issues = shortGradeIssues({ points: [{ index: 0, awarded: 3, reason: "x" }], feedback: "" }, rubric).join("\n");
    assert.match(issues, /point 0: awarded must be between 0 and 2/);
    assert.match(issues, /rubric point 1 needs exactly one entry/);
    assert.match(issues, /feedback needs/);
  });

  test("half marks or more counts as correct", () => {
    assert.ok(shortIsCorrect(2.5, 5));
    assert.ok(!shortIsCorrect(2, 5));
  });
});
