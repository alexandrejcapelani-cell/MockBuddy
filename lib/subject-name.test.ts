import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSubjectName, MAX_SUBJECT_NAME } from "./subject-name.ts";

test("keeps the typed text, trimming and collapsing whitespace", () => {
  assert.deepEqual(cleanSubjectName("  QA-7F3K2A   grading bot test \n"), { ok: true, name: "QA-7F3K2A grading bot test" });
  assert.deepEqual(cleanSubjectName("Econometrics"), { ok: true, name: "Econometrics" });
});

test("refuses only an empty or overlong name", () => {
  assert.equal(cleanSubjectName("   ").ok, false);
  assert.equal(cleanSubjectName("x".repeat(MAX_SUBJECT_NAME)).ok, true);
  assert.equal(cleanSubjectName("x".repeat(MAX_SUBJECT_NAME + 1)).ok, false);
});
