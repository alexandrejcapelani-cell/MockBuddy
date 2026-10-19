import assert from "node:assert/strict";
import { test } from "node:test";
import { mathProblems, splitMath } from "./math.ts";

test("splits inline and display math from text", () => {
  assert.deepEqual(splitMath(String.raw`If \(\hat{\beta}_1 > 0\) then \[E[u|x]=0\] holds.`), [
    { kind: "text", value: "If " },
    { kind: "inline", value: String.raw`\hat{\beta}_1 > 0` },
    { kind: "text", value: " then " },
    { kind: "display", value: "E[u|x]=0" },
    { kind: "text", value: " holds." },
  ]);
});

test("a $ amount is plain text", () => {
  assert.deepEqual(splitMath("A $5 rise and a $10 fall"), [{ kind: "text", value: "A $5 rise and a $10 fall" }]);
  assert.deepEqual(mathProblems("A $5 rise and a $10 fall"), []);
});

test("valid econometrics LaTeX has no problems", () => {
  assert.deepEqual(mathProblems(String.raw`\(\text{Var}(\hat{\beta}_j) = \frac{\sigma^2}{SST_j(1-R_j^2)}\)`), []);
});

test("flags $-delimited math, unclosed delimiters and broken LaTeX", () => {
  assert.equal(mathProblems(String.raw`the estimate $\hat\beta$ is`).length, 1);
  assert.match(mathProblems(String.raw`open \(\beta`)[0], /unclosed/);
  assert.match(mathProblems(String.raw`\(\frac{1}{\)`)[0], /doesn't render/);
});
