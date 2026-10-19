import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { repairLatexEscapes, restoreLatexControlChars } from "./latex-json.ts";

/** What a model writes when it forgets to double LaTeX backslashes inside a JSON string. */
const parse = (raw: string) => JSON.parse(repairLatexEscapes(raw));

describe("repairLatexEscapes", () => {
  test("\\beta, \\frac, \\theta, \\nu, \\rho collide with JSON escapes and are kept as LaTeX", () => {
    const raw = String.raw`{"p": "\(\beta_1 = \frac{\theta}{\nu}\), \(\rho\)"}`;
    assert.equal(parse(raw).p, String.raw`\(\beta_1 = \frac{\theta}{\nu}\), \(\rho\)`);
  });

  test("\\hat, \\sigma and the \\( \\) delimiters are invalid JSON escapes and get doubled", () => {
    const raw = String.raw`{"p": "\(\hat{\beta}_{OLS}\) has variance \(\sigma^2 (X'X)^{-1}\)"}`;
    assert.equal(parse(raw).p, String.raw`\(\hat{\beta}_{OLS}\) has variance \(\sigma^2 (X'X)^{-1}\)`);
  });

  test("display math, \\text, \\times, \\left( and \\right)", () => {
    const raw = String.raw`{"p": "\[\text{Var}(\hat{\beta}) = \left(\frac{1}{n}\right) \times s^2\]"}`;
    assert.equal(parse(raw).p, String.raw`\[\text{Var}(\hat{\beta}) = \left(\frac{1}{n}\right) \times s^2\]`);
  });

  test("\\underline and \\upsilon are not unicode escapes", () => {
    const raw = String.raw`{"p": "\(\underline{x}\), \(\upsilon\)"}`;
    assert.equal(parse(raw).p, String.raw`\(\underline{x}\), \(\upsilon\)`);
  });

  test("correctly doubled backslashes are left alone", () => {
    const raw = String.raw`{"p": "\\(\\hat{\\beta}_1\\)"}`;
    assert.equal(parse(raw).p, String.raw`\(\hat{\beta}_1\)`);
  });

  test("genuine newlines, tabs, quotes and unicode escapes survive", () => {
    const raw = String.raw`{"p": "Line one\nThe next line\tindented \"quoted\" caf\u00e9"}`;
    assert.equal(parse(raw).p, 'Line one\nThe next line\tindented "quoted" café');
  });

  test("text outside strings is untouched", () => {
    const raw = String.raw`{"a": 1, "b": [true, null], "c": "\beta"}`;
    assert.deepEqual(parse(raw), { a: 1, b: [true, null], c: String.raw`\beta` });
  });
});

describe("restoreLatexControlChars", () => {
  test("restores \\beta and \\frac from backspace and form feed anywhere", () => {
    const broken = JSON.parse(String.raw`{"p": "coefficient \\(\beta_1\\) and \frac{1}{2}"}`);
    assert.equal(restoreLatexControlChars(broken).p, String.raw`coefficient \(\beta_1\) and \frac{1}{2}`);
  });

  test("restores \\theta and \\nu inside math, keeps real newlines and tabs outside", () => {
    const broken = JSON.parse(String.raw`{"p": "first\nsecond\\(\theta + \nu\\)\tend"}`);
    assert.equal(restoreLatexControlChars(broken).p, "first\nsecond" + String.raw`\(\theta + \nu\)` + "\tend");
  });

  test("walks nested arrays and objects", () => {
    const broken = JSON.parse(String.raw`{"options": ["\\(\beta\\)", "plain"], "n": 3}`);
    assert.deepEqual(restoreLatexControlChars(broken), { options: [String.raw`\(\beta\)`, "plain"], n: 3 });
  });
});
