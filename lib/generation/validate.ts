import { isVerbatim } from "../blueprint/rules.ts";
import { mathProblems } from "../math.ts";
import type { GeneratedQuestion } from "../schemas.ts";
import type { PlanSlot } from "./types.ts";

// Per-question validation for drafts and revisions (spec sections 8 and 9). Issues are
// worded for the model, which gets them back on a retry.

const MIN_EXPLANATION_WORDS = 8;
const MIN_OPTIONS = 3;
const MAX_OPTIONS = 6;

export interface SlotSources {
  primary: string;
  secondary: string | null;
}

export function questionIssues(question: GeneratedQuestion, slot: PlanSlot, sources: SlotSources): string[] {
  const issues: string[] = [];
  const add = (issue: string) => issues.push(`slot ${slot.ordinal}: ${issue}`);

  if (question.type !== slot.type) add(`type must be "${slot.type}", not "${question.type}".`);
  if (words(question.prompt).length < 5) add("the prompt is too short to be a question.");
  if (words(question.correct_explanation).length < MIN_EXPLANATION_WORDS) {
    add(`correct_explanation needs at least ${MIN_EXPLANATION_WORDS} words of reasoning.`);
  }
  if (words(question.worked_solution).length < MIN_EXPLANATION_WORDS) add("worked_solution is too short.");

  if (slot.type === "mcq") mcqIssues(question, add);
  if (slot.type === "short") shortIssues(question, slot, add);
  if (slot.type === "numerical") numericalIssues(question, add);

  const excerptWords = words(question.source_excerpt).length;
  if (excerptWords < 3 || excerptWords > 40) {
    add("source_excerpt must be a phrase of 5 to 25 words copied from the primary chunk.");
  } else if (!isVerbatim(question.source_excerpt, sources.primary) && !(sources.secondary && isVerbatim(question.source_excerpt, sources.secondary))) {
    add(`source_excerpt "${question.source_excerpt.slice(0, 60)}" does not appear in the slot's chunk; copy it exactly from the material.`);
  }

  for (const [field, text] of textFields(question)) {
    for (const problem of mathProblems(text)) add(`${field} ${problem}.`);
  }
  return issues;
}

function mcqIssues(question: GeneratedQuestion, add: (issue: string) => void) {
  const options = question.options ?? [];
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    add(`an mcq needs ${MIN_OPTIONS} to ${MAX_OPTIONS} options; it has ${options.length}.`);
    return;
  }
  if (options.some((option) => option.trim() === "")) add("an option is empty.");
  const distinct = new Set(options.map((option) => option.trim().toLowerCase()));
  if (distinct.size !== options.length) add("two options are identical.");

  const correct = question.correct_option;
  if (correct === null || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
    add(`correct_option must be an index from 0 to ${options.length - 1}.`);
    return;
  }

  const explanations = question.option_explanations ?? [];
  if (explanations.length !== options.length) {
    add(`option_explanations must have one entry per option (${options.length}); it has ${explanations.length}.`);
  }
  options.forEach((option, index) => {
    const entries = explanations.filter((entry) => entry.index === index);
    if (entries.length !== 1) {
      add(`option ${index} needs exactly one entry in option_explanations.`);
      return;
    }
    const [entry] = entries;
    if (entry.is_correct !== (index === correct)) {
      add(`option_explanations[${index}].is_correct must be ${index === correct} (correct_option is ${correct}).`);
    }
    const own = new Set(words(option));
    const beyondOption = words(entry.explanation).filter((word) => !own.has(word));
    if (beyondOption.length < MIN_EXPLANATION_WORDS) {
      add(
        index === correct
          ? `the explanation for the correct option ${index} only restates it; state the principle it rests on and connect it to the material.`
          : `the explanation for option ${index} only restates it; name the specific misconception behind it and the fact that refutes it.`,
      );
    }
  });
}

function shortIssues(question: GeneratedQuestion, slot: PlanSlot, add: (issue: string) => void) {
  if (!question.expected_answer || words(question.expected_answer).length < MIN_EXPLANATION_WORDS) {
    add("a short-answer question needs a model expected_answer.");
  }
  const rubric = question.rubric ?? [];
  if (rubric.length === 0) {
    add("a short-answer question needs a rubric of marking points.");
    return;
  }
  if (rubric.some((point) => point.point.trim() === "" || !(point.marks > 0))) {
    add("every rubric point needs text and positive marks.");
  }
  const total = rubric.reduce((sum, point) => sum + point.marks, 0);
  if (Math.abs(total - slot.marks) > 0.01) add(`rubric marks add up to ${total}; they must add up to the question's ${slot.marks} marks.`);
}

function numericalIssues(question: GeneratedQuestion, add: (issue: string) => void) {
  const answer = question.numeric_answer;
  const tolerance = question.tolerance;
  if (answer === null || !Number.isFinite(answer)) add("a numerical question needs a finite numeric_answer.");
  if (tolerance === null || !Number.isFinite(tolerance) || tolerance < 0) {
    add("a numerical question needs a tolerance of 0 or more, matching the precision the stem asks for.");
  } else if (answer !== null && answer !== 0 && tolerance >= Math.abs(answer)) {
    add(`tolerance ${tolerance} is as large as the answer itself; use the precision the stem asks for.`);
  }
}

function textFields(question: GeneratedQuestion): [string, string][] {
  const fields: [string, string][] = [
    ["prompt", question.prompt],
    ["correct_explanation", question.correct_explanation],
    ["worked_solution", question.worked_solution],
  ];
  question.options?.forEach((option, i) => fields.push([`option ${i}`, option]));
  question.option_explanations?.forEach((entry) => fields.push([`option_explanations[${entry.index}]`, entry.explanation]));
  if (question.expected_answer) fields.push(["expected_answer", question.expected_answer]);
  return fields;
}

function words(text: string | null): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/\\[a-z]+/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * The stored form of a valid question: fields that belong to the slot (marks, topic) come
 * from the plan, and fields irrelevant to the type are null.
 */
export function normalizeQuestion(question: GeneratedQuestion, slot: PlanSlot): GeneratedQuestion {
  const base = { ...question, type: slot.type, marks: slot.marks, topic_label: slot.topicLabel };
  if (slot.type === "mcq") {
    return {
      ...base,
      options: question.options ? stripOptionLabels(question.options) : question.options,
      option_explanations: [...(question.option_explanations ?? [])].sort((a, b) => a.index - b.index),
      expected_answer: null,
      rubric: null,
      numeric_answer: null,
      tolerance: null,
      unit: null,
    };
  }
  const noOptions = { options: null, correct_option: null, option_explanations: null };
  if (slot.type === "short") return { ...base, ...noOptions, numeric_answer: null, tolerance: null, unit: null };
  return { ...base, ...noOptions, expected_answer: null, rubric: null };
}

/**
 * Removes letter labels the model copied from the sample paper ("(a) …", "A. …", "b) …"),
 * since the app shows its own A–D. Only when every option starts with its own position's
 * letter, so an option that merely begins with a letter keeps it.
 */
export function stripOptionLabels(options: string[]): string[] {
  const label = (index: number) => {
    const letter = String.fromCharCode(97 + index);
    return new RegExp(`^\\s*(?:\\(${letter}\\)|${letter}[).:])\\s+`, "i");
  };
  if (options.length === 0 || !options.every((option, i) => label(i).test(option))) return options;
  return options.map((option, i) => option.replace(label(i), ""));
}
