import type { BlueprintSpec, GeneratedQuestion, SampleQuestion } from "../schemas.ts";
import { DIFFICULTY_DEFINITIONS } from "./difficulty.ts";
import type { ExamDifficulty, PlanSlot } from "./types.ts";

// Prompts for stage C: C1 draft, C2 critique, C3 revise. Draft and revise share one
// system prompt, built once per exam, so later calls hit the prompt cache.

export interface ExamContext {
  spec: BlueprintSpec;
  sampleQuestions: SampleQuestion[];
  difficulty: ExamDifficulty;
}

export interface SlotWithSources {
  slot: PlanSlot;
  primary: { sectionLabel: string; content: string };
  secondary: { sectionLabel: string; content: string } | null;
}

/** What counts as testing the same point, for every prompt that asks for a different one. */
const SAME_POINT =
  "The same point means the same fact, definition, distinction, formula, procedure or calculation, whatever the format or scenario: a multiple-choice question and a written question on it are a repeat, and so are two calculations of the same quantity with different numbers.";

const MATH_RULES = `Math notation
- Write mathematics in LaTeX between \\( and \\) inline, or \\[ and \\] for display. Never use $ for math: $ always means an amount of money.
- In the JSON every backslash is doubled: write "\\\\(\\\\hat{\\\\beta}_1\\\\)" to produce \\(\\hat{\\beta}_1\\).
- Slide text often writes math as plain text (b1hat, sigma^2, x_i1, Var(u | x)). Write it as proper LaTeX in your questions, but copy source_excerpt exactly as the chunk has it.`;

function examBlocks(exam: ExamContext): string {
  const samples = exam.sampleQuestions
    .map((sample, i) => `<sample_question number="${i + 1}" type="${sample.type}">\n${sample.verbatim_text}\n</sample_question>`)
    .join("\n");
  return `<blueprint>\n${JSON.stringify(exam.spec, null, 2)}\n</blueprint>

<sample_questions>
These are copied word for word from the real exam. Match how they are written; never reuse their content.
${samples}
</sample_questions>

<difficulty>\n${DIFFICULTY_DEFINITIONS[exam.difficulty]}\n</difficulty>`;
}

export function generationSystem(exam: ExamContext, schema: string): string {
  return `You write practice exam questions for a university student, in the style of one real past exam, using only the student's own course material.

You are given the real exam's blueprint, questions copied word for word from it, and the difficulty to write at, defined precisely: follow the definition, not your own idea of the word. Each request lists slots, one per question, each with its type, marks, section style notes and the material it must be based on, plus questions that already exist.

Rules for every question
1. Base it only on the slot's material. Everything needed to answer must be stated in, or follow directly from, that material. Never rely on outside facts.
2. Exactly one defensible correct answer.
3. Multiple-choice distractors: every wrong option must be one a student who studied the material could pick because of a specific misconception or error, such as confusing unbiasedness with efficiency, reversing the direction of a bias, or applying the wrong formula. No filler, no absurd options. Options are parallel in form and similar in length. Write each option without a letter or number label (no "(a)" or "A."): the app labels them. Vary the position of the correct option. Use the number of options the blueprint's style notes describe.
4. Match the sample questions' phrasing conventions and stem length, adjusted only as the difficulty definition says.
5. Test a point no existing question tests, and a different point from every other slot in the request. ${SAME_POINT}

Explanations (the most important part)
- option_explanations: one entry per option, in option order; index is the option's position from 0; is_correct is true only for the correct option.
  - Each wrong option: name the specific misconception or error that would lead a student to pick it (never just "this is incorrect"; say what it confuses, for example "this confuses unbiasedness with efficiency"), then state the fact or principle that refutes it. 1 to 2 sentences.
  - The correct option: state the principle the answer rests on and connect it to the material. 2 to 4 sentences.
  - Never just restate the option's wording.
- correct_explanation: 2 to 4 sentences giving the full reasoning, referring to the material.
- worked_solution: the complete reasoning a strong student would write; step by step for calculations.

Fields by type
- mcq: options, correct_option (index from 0) and option_explanations. expected_answer, rubric, numeric_answer, tolerance and unit are null.
- short: expected_answer (a model answer) and rubric (marking points whose marks add up exactly to the slot's marks). options, correct_option, option_explanations, numeric_answer, tolerance and unit are null.
- numerical: numeric_answer, tolerance (the absolute error accepted, matching the precision the stem asks for: 0.005 for "to two decimal places"), unit (null if none). The stem supplies every number needed and says what precision to give. options, correct_option, option_explanations, expected_answer and rubric are null.
- Every question: marks is the slot's marks; topic_label is the slot's topic label, unchanged; difficulty is your honest rating ("easy", "medium" or "hard"); source_excerpt is a phrase of 5 to 25 words copied exactly, character for character, from the slot's primary chunk: the passage the question rests on.

${MATH_RULES}

Reply with a JSON object only: no prose, no code fences. It must match this schema:
${schema}

${examBlocks(exam)}`;
}

function slotBlock({ slot, primary, secondary }: SlotWithSources, difficulty: ExamDifficulty): string {
  const lines = [
    `<slot number="${slot.ordinal}" type="${slot.type}" marks="${slot.marks}" section="${attr(slot.sectionName)}">`,
    `<topic_label>${slot.topicLabel}</topic_label>`,
    `<section_style>${slot.styleNotes}</section_style>`,
  ];
  if (difficulty === "same") lines.push(`<observed_difficulty>${slot.observedDifficulty}</observed_difficulty>`);
  lines.push(`<primary_chunk section="${attr(primary.sectionLabel)}">\n${primary.content}\n</primary_chunk>`);
  if (secondary) {
    lines.push(
      `<secondary_chunk section="${attr(secondary.sectionLabel)}">\n${secondary.content}\n</secondary_chunk>`,
      "<note>HARDER: the question should require combining the primary and secondary chunks, or applying a principle from them to a scenario the material doesn't contain, or reasoning backwards from a result to its cause.</note>",
    );
  }
  lines.push("</slot>");
  return lines.join("\n");
}

function existingBlock(existingStems: string[]): string {
  if (existingStems.length === 0) return "<existing_questions>\n(none)\n</existing_questions>";
  return `<existing_questions>\nDo not repeat, closely paraphrase or test the same point as any of these. ${SAME_POINT}\n${existingStems
    .map((stem, i) => `${i + 1}. ${stem}`)
    .join("\n")}\n</existing_questions>`;
}

export function draftPrompt(slots: SlotWithSources[], existingStems: string[], difficulty: ExamDifficulty): string {
  return `${existingBlock(existingStems)}

<slots>
${slots.map((slot) => slotBlock(slot, difficulty)).join("\n\n")}
</slots>

Write exactly ${slots.length} question${slots.length === 1 ? "" : "s"}: one per slot, in slot order, with each question's "slot" set to its slot number.`;
}

export interface RevisionRequest {
  source: SlotWithSources;
  draft: GeneratedQuestion;
  instructions: string[];
}

export function revisePrompt(requests: RevisionRequest[], existingStems: string[], difficulty: ExamDifficulty): string {
  const blocks = requests.map(
    ({ source, draft, instructions }) => `${slotBlock(source, difficulty)}
<draft slot="${source.slot.ordinal}">
${JSON.stringify(draft, null, 2)}
</draft>
<examiner_instructions slot="${source.slot.ordinal}">
${instructions.map((instruction) => `- ${instruction}`).join("\n")}
</examiner_instructions>`,
  );
  return `${existingBlock(existingStems)}

An examiner reviewed these draft questions and asked for revisions.

${blocks.join("\n\n")}

Revise each draft so it fixes everything the examiner raised and still follows every rule. Keep the slot, type, marks and topic. Keep what was already good. Return exactly ${requests.length} question${requests.length === 1 ? "" : "s"}, one per slot listed, with "slot" set to its slot number.`;
}

export function critiqueSystem(exam: ExamContext, schema: string): string {
  return `You are a strict examiner reviewing draft practice exam questions before a student sees them. Each draft comes with the course material it must be based on. You also have the real exam's blueprint, questions copied word for word from it, and the difficulty the drafts should be written at.

For every draft, decide:
- answerable_from_material: can it be answered from the supplied chunk(s) alone? false if it needs outside facts, or if the keyed answer contradicts the material.
- single_defensible_answer: is there exactly one defensible correct answer, and is it the one keyed? false if two options could be argued, or if the key is wrong. For numerical questions, work the answer out yourself from the stem; false if yours differs from numeric_answer by more than the tolerance.
- filler_distractors: indexes of multiple-choice options that are obvious filler, that a student who studied would never pick, or that don't correspond to a specific misconception. Empty if every distractor is plausible (and for non-MCQ questions).
- matches_sample_style: does it follow the sample questions' phrasing conventions and stem length, as adjusted by the difficulty definition?
- duplicates_earlier_question: does it test the same point as an existing question or another draft in this batch? ${SAME_POINT} When you ask for a different point, don't suggest one that an existing question or another draft already tests.
- Also judge the explanations. Each wrong option's explanation must name a specific misconception and state what refutes it; the correct option's must state the principle and connect it to the material. A vague, circular or wrong explanation is a reason to revise.
- verdict: "pass" only if every check is satisfied and the explanations meet that standard; otherwise "revise".
- instructions: for "revise", specific instructions to fix the question: what is wrong and what to change. null for "pass".

Be strict but fair: ask for revisions that make the question better for the student, not for trivia.

Math in the drafts is LaTeX between \\( \\) or \\[ \\], and $ means money; that is correct.

Reply with a JSON object only: no prose, no code fences. It must match this schema:
${schema}

${examBlocks(exam)}`;
}

export function critiquePrompt(drafts: { source: SlotWithSources; draft: GeneratedQuestion }[], existingStems: string[], difficulty: ExamDifficulty): string {
  const blocks = drafts.map(
    ({ source, draft }) => `${slotBlock(source, difficulty)}
<draft slot="${source.slot.ordinal}">
${JSON.stringify(draft, null, 2)}
</draft>`,
  );
  return `${existingBlock(existingStems)}

${blocks.join("\n\n")}

Review each draft. Return exactly ${drafts.length} verdict${drafts.length === 1 ? "" : "s"}, one per draft, with "slot" set to its slot number.`;
}

function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export interface RepeatCheckQuestion {
  /** The saved question's number, or the new question's slot. */
  number: number;
  type: GeneratedQuestion["type"];
  prompt: string;
  /** The keyed answer, in words: the correct option, the model answer or the number. */
  answer: string;
}

export function repeatCheckSystem(schema: string): string {
  return `You check a practice exam for repeated questions before new ones are added to it. The student may already be answering the saved questions, so a new question that repeats one of them must be left out.

A new question repeats a saved one when the same piece of knowledge answers both. ${SAME_POINT} Questions on the same topic that test different points are not repeats: for example, one on what makes an instrument weak and one on why an instrument's exogeneity can't be tested.

For every new question, set "repeats" to the number of the saved question it repeats, or null if it repeats none, and "same_point" to the point both test (null when it repeats none). Compare each new question with the saved questions only, not with the other new questions.

Reply with a JSON object only: no prose, no code fences. It must match this schema:
${schema}`;
}

export function repeatCheckPrompt(fresh: RepeatCheckQuestion[], saved: RepeatCheckQuestion[]): string {
  const block = (tag: string, attribute: string, question: RepeatCheckQuestion) =>
    `<${tag} ${attribute}="${question.number}" type="${question.type}">\n${question.prompt}\nAnswer: ${question.answer}\n</${tag}>`;
  return `<saved_questions>
${saved.map((question) => block("question", "number", question)).join("\n")}
</saved_questions>

<new_questions>
${fresh.map((question) => block("question", "slot", question)).join("\n")}
</new_questions>

Return exactly ${fresh.length} verdict${fresh.length === 1 ? "" : "s"}, one per new question, with "slot" set to its slot number.`;
}

/** A question's keyed answer in words, for the repeat check. */
export function answerText(question: {
  type: GeneratedQuestion["type"];
  options: string[] | null;
  correct_option: number | null;
  expected_answer: string | null;
  numeric_answer: number | null;
  unit: string | null;
}): string {
  if (question.type === "mcq") return question.options?.[question.correct_option ?? -1] ?? "(no key)";
  if (question.type === "short") return question.expected_answer ?? "(no model answer)";
  return question.numeric_answer === null ? "(no number)" : `${question.numeric_answer}${question.unit ? ` ${question.unit}` : ""}`;
}
