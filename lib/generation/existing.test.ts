import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { GeneratedQuestion } from "../schemas.ts";
import { excludedStemList, inFlightStems, type SiblingBatch } from "./existing.ts";
import { answerText, critiquePrompt, repeatCheckPrompt } from "./prompts.ts";
import { nearDuplicateSlots } from "./similarity.ts";
import type { DraftSlot, PlanSlot, SlotOutcome } from "./types.ts";

// The bug: in a 10-question mock, slot 2 (batch 0) and slot 6 (batch 1) both asked what adding
// an irrelevant variable does to R². The two batches drafted at the same time, and each one's
// critique saw only the questions already saved, so neither the word-overlap check nor the
// examiner ever saw the other batch's draft.

const R2_SLOT_2 = "In a multiple regression, what happens to the R-squared when an irrelevant explanatory variable is added to the model?";
const R2_SLOT_6 = "What happens to the R-squared of a multiple regression when an irrelevant explanatory variable is added to the model?";

const SAMPLES = [
  "Under MLR.1 to MLR.4, which of the following is true of the OLS estimator of the slope?",
  "Explain why heteroskedasticity does not bias the OLS coefficients.",
];

const question = (prompt: string): GeneratedQuestion => ({
  type: "mcq",
  prompt,
  marks: 2,
  options: ["It never decreases", "It always decreases", "It is unchanged", "It falls only in small samples"],
  correct_option: 0,
  option_explanations: [
    { index: 0, is_correct: true, explanation: "OLS minimises the SSR, and an extra regressor can only lower it, so R-squared cannot fall." },
    { index: 1, is_correct: false, explanation: "This confuses R-squared with adjusted R-squared, which penalises extra regressors." },
    { index: 2, is_correct: false, explanation: "This assumes a zero sample coefficient; in a sample the estimate is almost never exactly zero." },
    { index: 3, is_correct: false, explanation: "This mixes up R-squared with the precision of the estimates, which does depend on the sample size." },
  ],
  correct_explanation: "The SSR can only fall when a regressor is added, so R-squared never decreases.",
  expected_answer: null,
  rubric: null,
  numeric_answer: null,
  tolerance: null,
  unit: null,
  worked_solution: "R-squared = 1 - SSR/SST; adding a regressor cannot raise the minimised SSR.",
  source_excerpt: "R-squared never decreases when another regressor is added",
  topic_label: "Goodness of fit",
  difficulty: "medium",
});

const draft = (slot: number, prompt: string | null): DraftSlot => ({ slot, question: prompt === null ? null : question(prompt), rejected: null, issues: [] });

const batch = (batchIndex: number, stage: SiblingBatch["stage"], drafts: DraftSlot[], outcomes: SlotOutcome[] = []): SiblingBatch => ({
  batchIndex,
  stage,
  drafts,
  outcomes,
});

const planSlot = (ordinal: number): PlanSlot => ({
  ordinal,
  type: "mcq",
  sectionName: "Section A",
  marks: 2,
  styleNotes: "Four options.",
  observedDifficulty: "medium",
  chunkId: "c-fit",
  secondaryChunkId: null,
  topicLabel: "Goodness of fit",
  replacesSlot: null,
});

// Each batch as the database holds it once both have drafted: batch 0 reached its critique
// first, and batch 1's critique is about to start.
const batch0 = batch(0, "critique", [
  draft(1, "Which assumption guarantees that the OLS slope estimator is unbiased?"),
  draft(2, R2_SLOT_2),
  draft(3, "Compute the OLS slope from the sample covariance of x and y and the sample variance of x given below."),
  draft(4, "Why does perfect collinearity between two regressors make OLS impossible to compute?"),
  draft(5, "What does the standard error of a regression coefficient measure?"),
]);
const batch1 = batch(1, "critique", [
  draft(6, R2_SLOT_6),
  draft(7, "Which statement about the omitted variable bias formula is correct?"),
  draft(8, "Explain what the zero conditional mean assumption requires of the error term."),
  draft(9, "Interpret the coefficient on education in a log(wage) regression."),
  draft(10, "When is the simple regression slope equal to the multiple regression slope on the same variable?"),
]);
const prompts = (b: SiblingBatch) => b.drafts.flatMap((d) => (d.question ? [{ slot: d.slot, prompt: d.question.prompt }] : []));

describe("a repeat across two batches drafting at the same time", () => {
  test("seen from saved questions only (as before), batch 1's critique can't catch it", () => {
    const before = excludedStemList({ samples: SAMPLES, saved: [], inFlight: [], earlierMocks: [] });
    assert.equal(nearDuplicateSlots(prompts(batch1), before).size, 0);
  });

  test("batch 1's critique sees batch 0's drafts, and the overlap check sends slot 6 back", () => {
    const existing = excludedStemList({ samples: SAMPLES, saved: [], inFlight: inFlightStems([batch0, batch1], 1), earlierMocks: [] });
    assert.ok(existing.includes(R2_SLOT_2));
    assert.deepEqual([...nearDuplicateSlots(prompts(batch1), existing)], [[6, R2_SLOT_2]]);
  });

  test("the examiner is shown batch 0's slot 2 among the existing questions, for rewordings the overlap check misses", () => {
    const existing = excludedStemList({ samples: SAMPLES, saved: [], inFlight: inFlightStems([batch0, batch1], 1), earlierMocks: [] });
    const reviewed = batch1.drafts.map((d) => ({
      source: { slot: planSlot(d.slot), primary: { sectionLabel: "Lecture 3", content: "R-squared never decreases when another regressor is added." }, secondary: null },
      draft: d.question!,
    }));
    const prompt = critiquePrompt(reviewed, existing, "same");
    const existingBlock = prompt.slice(prompt.indexOf("<existing_questions>"), prompt.indexOf("</existing_questions>"));
    assert.ok(existingBlock.includes(R2_SLOT_2));
  });

  test("batch 0 keeps its question: its critique ran while batch 1 was still drafting", () => {
    const stillDrafting = batch(1, "draft", []);
    const existing = excludedStemList({ samples: SAMPLES, saved: [], inFlight: inFlightStems([batch0, stillDrafting], 0), earlierMocks: [] });
    assert.ok(!existing.includes(R2_SLOT_6));
    assert.equal(nearDuplicateSlots(prompts(batch0), existing).size, 0);
  });

  test("on saving, a batch drops a question too close to one another batch saved first", () => {
    // Batch 0 saved slot 2 first; batch 1's slot 6 got through its critique (say batch 0 then
    // revised slot 2 into this wording), and is caught when batch 1 saves.
    const savedByBatch0 = [R2_SLOT_2, "Which assumption guarantees that the OLS slope estimator is unbiased?"];
    assert.deepEqual([...nearDuplicateSlots(prompts(batch1), savedByBatch0)], [[6, R2_SLOT_2]]);
  });
});

describe("inFlightStems", () => {
  test("leaves out the batch's own drafts, finished and failed batches, missing drafts and dropped slots", () => {
    const batches = [
      batch(0, "revise", [draft(1, "own draft")]),
      batch(1, "done", [draft(6, "saved already, so read from the questions table")]),
      batch(2, "failed", [draft(11, "failed batch")]),
      batch(3, "critique", [draft(16, "in flight"), draft(17, null), draft(18, "dropped after its retry")], [
        { slot: 18, status: "dropped", revised: false, reason: "Failed validation twice." },
      ]),
    ];
    assert.deepEqual(inFlightStems(batches, 0), ["in flight"]);
  });
});

describe("excludedStemList", () => {
  test("this mock's own stems come before earlier mocks', so a long chain doesn't push them out", () => {
    const earlierMocks = Array.from({ length: 100 }, (_, i) => `Question ${i + 1} from an earlier mock`);
    const list = excludedStemList({ samples: SAMPLES, saved: ["saved in this mock"], inFlight: [R2_SLOT_2], earlierMocks });
    assert.equal(list.length, 60);
    assert.deepEqual(list.slice(0, 4), [...SAMPLES, "saved in this mock", R2_SLOT_2]);
  });

  test("a stem both saved and still in a batch's drafts is listed once", () => {
    assert.deepEqual(excludedStemList({ samples: [], saved: [R2_SLOT_2], inFlight: [R2_SLOT_2], earlierMocks: [] }), [R2_SLOT_2]);
  });

  test("long stems are shortened", () => {
    const [stem] = excludedStemList({ samples: ["x".repeat(400)], saved: [], inFlight: [], earlierMocks: [] });
    assert.equal(stem, `${"x".repeat(300)}…`);
  });
});

describe("the repeat check when a batch saves", () => {
  // From a 20-question run: batch 0 saved slot 5 (an MCQ); batch 3's examiner saw its draft but
  // passed slot 17, a written question on the same point.
  const slot5 = { ...question("For an instrumental variable z to be valid for an endogenous regressor x, it must satisfy relevance and exogeneity. Which statement is correct?"), options: ["Both can be tested with one instrument", "Relevance can be tested; exogeneity cannot", "Exogeneity can be tested; relevance cannot", "Neither can be tested"], correct_option: 1 };
  const slot17 = {
    ...question("State the two conditions an instrumental variable z must satisfy, and say for each whether it can be tested with a single instrument."),
    type: "short" as const,
    options: null,
    correct_option: null,
    option_explanations: null,
    expected_answer: "Relevance (Cov(z, x) is not 0), testable in the first stage; exogeneity (Cov(z, u) = 0), not testable with one instrument.",
  };

  test("each question is shown with its keyed answer, since an MCQ's stem alone doesn't say what it tests", () => {
    assert.equal(answerText(slot5), "Relevance can be tested; exogeneity cannot");
    assert.equal(answerText(slot17), slot17.expected_answer);
    assert.equal(answerText({ ...slot5, type: "numerical", options: null, correct_option: null, numeric_answer: 0.75, unit: null }), "0.75");
    assert.equal(answerText({ ...slot5, type: "numerical", options: null, correct_option: null, numeric_answer: 16, unit: "points" }), "16 points");
  });

  test("the prompt numbers the saved questions and gives each new one its slot", () => {
    const prompt = repeatCheckPrompt(
      [{ number: 17, type: "short", prompt: slot17.prompt, answer: answerText(slot17) }],
      [{ number: 5, type: "mcq", prompt: slot5.prompt, answer: answerText(slot5) }],
    );
    assert.match(prompt, /<saved_questions>\n<question number="5" type="mcq">\nFor an instrumental variable[^]*Answer: Relevance can be tested; exogeneity cannot\n<\/question>\n<\/saved_questions>/);
    assert.match(prompt, /<new_questions>\n<question slot="17" type="short">/);
    assert.match(prompt, /Return exactly 1 verdict, one per new question/);
  });
});
