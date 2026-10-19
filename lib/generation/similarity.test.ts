import assert from "node:assert/strict";
import { test } from "node:test";
import { findNearDuplicate, SIMILARITY_THRESHOLD, stemSimilarity } from "./similarity.ts";

const sample =
  "1. Adding an irrelevant regressor to a multiple regression will (a) always increase the adjusted R-squared. (b) never decrease the R-squared.";

test("an identical stem scores 1", () => assert.equal(stemSimilarity(sample, sample), 1));

test("a light rewording of a sample question is caught", () => {
  const reworded = "Adding an irrelevant regressor to a regression will";
  assert.ok(stemSimilarity(reworded, sample) >= SIMILARITY_THRESHOLD);
  assert.ok(findNearDuplicate(reworded, ["Something else entirely about instruments", sample]));
});

test("stems that share only a question template are not duplicates", () => {
  const a = "Which of the following statements about heteroskedasticity-robust standard errors in a wage regression is correct?";
  const b = "Which of the following statements about the first-stage F statistic in a 2SLS regression is correct?";
  assert.ok(stemSimilarity(a, b) < SIMILARITY_THRESHOLD);
});

test("unrelated stems score near 0", () => {
  const a = "Compute the IV estimate of the slope from the covariances given, to two decimal places.";
  const b = "Explain why multicollinearity inflates the variance of the OLS slope estimator.";
  assert.ok(stemSimilarity(a, b) < 0.1);
});

test("LaTeX commands count as words", () => {
  const a = String.raw`Under MLR.1 to MLR.4, what is \(E[\hat{\beta}_1]\) equal to?`;
  const b = "Under MLR.1 to MLR.4, what is E[hat beta 1] equal to?";
  assert.equal(stemSimilarity(a, b), 1);
});
