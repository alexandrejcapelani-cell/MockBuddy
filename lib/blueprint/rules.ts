import type { Blueprint, BlueprintSpec, QuestionType, SampleQuestion } from "../schemas.ts";

// Validation for the blueprint call (stage B). The verbatim check is what makes the sample
// questions trustworthy few-shot examples: each must really appear in the uploaded paper.

export const MAX_SAMPLE_TEXT_CHARS = 120_000;
const MIN_VERBATIM_CHARS = 20;
const SHINGLE_WORDS = 5;
const MIN_SHINGLE_COVERAGE = 0.9;

/** Problems with a blueprint response, worded for the model to fix. Empty means valid. */
export function blueprintIssues(blueprint: Blueprint, sourceText: string): string[] {
  const issues: string[] = [];
  if (blueprint.sections.length === 0) issues.push("sections is empty: describe at least one section of the paper.");

  blueprint.sections.forEach((section, i) => {
    if (!(section.proportion > 0)) issues.push(`sections[${i}] ("${section.name}"): proportion must be above 0.`);
    if (!(section.marks_each > 0)) issues.push(`sections[${i}] ("${section.name}"): marks_each must be above 0.`);
    if (section.style_notes.trim().split(/\s+/).length < 5) {
      issues.push(`sections[${i}] ("${section.name}"): style_notes is too thin; describe what these questions ask and how.`);
    }
  });
  const total = blueprint.sections.reduce((sum, section) => sum + section.proportion, 0);
  if (blueprint.sections.length > 0 && Math.abs(total - 1) > 0.1) {
    issues.push(`section proportions sum to ${total.toFixed(2)}; they must sum to 1 (shares of all questions by count).`);
  }
  if (blueprint.tone_notes.trim().split(/\s+/).length < 15) {
    issues.push("tone_notes is too short: cover person and verb forms, scenario openings, typical stem length in words, and how options are phrased.");
  }

  const samples = blueprint.sample_questions;
  if (samples.length === 0 || samples.length > 5) {
    issues.push(`sample_questions has ${samples.length} entries; copy 3 to 5 questions (all of them if the paper has fewer than 3).`);
  }
  const sectionTypes = new Set(blueprint.sections.map((section) => section.question_type));
  const sampleTypes = new Set(samples.map((sample) => sample.type));
  for (const sample of samples) {
    if (!sectionTypes.has(sample.type)) {
      issues.push(`a sample question has type "${sample.type}", but no section has that type.`);
    }
  }
  if (samples.length < 5) {
    for (const type of sectionTypes) {
      if (!sampleTypes.has(type)) issues.push(`no sample question has type "${type}"; include one so every question type is covered.`);
    }
  }

  samples.forEach((sample, i) => {
    const problem = verbatimProblem(sample, sourceText);
    if (problem) issues.push(`sample_questions[${i}]: ${problem}`);
  });
  return issues;
}

function verbatimProblem(sample: SampleQuestion, sourceText: string): string | null {
  const text = sample.verbatim_text.trim();
  if (text.length < MIN_VERBATIM_CHARS) return "the question is too short to be a complete question; copy all of it.";
  if (isVerbatim(text, sourceText)) return null;
  return `this is not copied verbatim from the paper (the passage beginning "${text.slice(0, 60)}…" was not found). Copy it character for character, options included.`;
}

/**
 * True when `excerpt` appears in `source`, ignoring differences that PDF extraction and
 * copying introduce: whitespace and line breaks, typographic quotes and dashes, case.
 * Falls back to near-complete coverage of 5-word runs to tolerate a stray glyph.
 */
export function isVerbatim(excerpt: string, source: string): boolean {
  const compact = (text: string) => normalizeForMatch(text).replace(/\s+/g, "");
  if (compact(source).includes(compact(excerpt))) return true;

  const sourceWords = normalizeForMatch(source).split(/\s+/).filter(Boolean);
  const excerptWords = normalizeForMatch(excerpt).split(/\s+/).filter(Boolean);
  if (excerptWords.length < SHINGLE_WORDS) return false;
  const sourceShingles = new Set(shingles(sourceWords));
  const excerptShingles = shingles(excerptWords);
  const covered = excerptShingles.filter((shingle) => sourceShingles.has(shingle)).length;
  return covered / excerptShingles.length >= MIN_SHINGLE_COVERAGE;
}

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(words: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) result.push(words.slice(i, i + SHINGLE_WORDS).join(" "));
  return result;
}

/** The blueprint as stored: proportions rescaled to sum to exactly 1, sample questions split off. */
export function toStoredBlueprint(blueprint: Blueprint): { spec: BlueprintSpec; sampleQuestions: SampleQuestion[] } {
  const total = blueprint.sections.reduce((sum, section) => sum + section.proportion, 0);
  const { sample_questions, ...rest } = blueprint;
  return {
    spec: { ...rest, sections: rest.sections.map((section) => ({ ...section, proportion: section.proportion / total })) },
    sampleQuestions: sample_questions.map((sample) => ({ ...sample, verbatim_text: sample.verbatim_text.trim() })),
  };
}

export const QUESTION_TYPE_NAMES: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  short: "Short answer",
  numerical: "Numerical",
};
