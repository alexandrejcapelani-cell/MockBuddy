import type { RubricPoint, ShortAnswerGrade } from "../schemas.ts";

// Deterministic marking (stage D) and the checks on model-marked answers.

/** A short answer counts as correct (gold in the navigator) at half marks or more. */
export const SHORT_CORRECT_FRACTION = 0.5;

const EPSILON = 1e-9;

/**
 * Reads a single number from a typed answer: "2.4", "2,4", "−2.40", "1,234.5", "$2.40",
 * "2.4 units", "≈ 2.4". Returns every reasonable reading: "1,234" could be 1234 or, with a
 * decimal comma, 1.234, so it returns both and the answer is right if either is. Null when
 * there is no number or more than one, which goes to the model to judge instead.
 */
export function parseNumericResponse(raw: string): number[] | null {
  const text = raw
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/[\s ]+/g, " ")
    .replace(/^(≈|~|about|approx\.?|approximately)\s*/i, "");
  const matches = text.match(/[-+]?(?:\d[\d,.']*\d|\d)(?:e[-+]?\d+)?/gi) ?? [];
  if (matches.length !== 1) return null;
  const [token] = matches;
  // Only a sign, currency or unit may surround the number.
  const rest = text.replace(token, "").replace(/[$€£%]/g, "").trim();
  if (rest !== "" && !/^[a-zA-Z/^0-9 ]{1,20}$/.test(rest)) return null;
  return readings(token);
}

function readings(token: string): number[] | null {
  const plain = token.replace(/'/g, "");
  // "1,234" or "0,620": thousands separator or decimal comma.
  if (/^[-+]?\d{1,3},\d{3}$/.test(plain)) {
    const values = [Number(plain.replace(",", "")), Number(plain.replace(",", "."))];
    return /^[-+]?0,/.test(plain) ? [values[1]] : values;
  }
  const value = toNumber(plain);
  return value === null ? null : [value];
}

function toNumber(token: string): number | null {
  let normalized = token;
  const commas = (normalized.match(/,/g) ?? []).length;
  const dots = (normalized.match(/\./g) ?? []).length;
  if (commas > 0 && dots > 0) {
    // "1,234.5" (comma thousands) or "1.234,5" (dot thousands): the last separator is the decimal point.
    normalized =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if (commas === 1) {
    normalized = normalized.replace(",", "."); // "2,4": decimal comma
  } else if (commas > 1) {
    normalized = normalized.replace(/,/g, ""); // "1,234,567"
  }
  if (dots > 1 && commas === 0) return null; // "1.2.3"
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function withinTolerance(value: number, answer: number, tolerance: number): boolean {
  return Math.abs(value - answer) <= tolerance + EPSILON * Math.max(1, Math.abs(answer));
}

/** Problems with a model's short-answer marking, worded for the model. Empty means valid. */
export function shortGradeIssues(grade: ShortAnswerGrade, rubric: RubricPoint[]): string[] {
  const issues: string[] = [];
  rubric.forEach((point, index) => {
    const entries = grade.points.filter((p) => p.index === index);
    if (entries.length !== 1) {
      issues.push(`rubric point ${index} needs exactly one entry in points.`);
      return;
    }
    const [entry] = entries;
    if (!(entry.awarded >= 0 && entry.awarded <= point.marks + EPSILON)) {
      issues.push(`point ${index}: awarded must be between 0 and ${point.marks}.`);
    }
    if (entry.reason.trim() === "") issues.push(`point ${index}: give a reason.`);
  });
  for (const entry of grade.points) {
    if (entry.index < 0 || entry.index >= rubric.length) issues.push(`point ${entry.index} is not in the rubric.`);
  }
  if (grade.feedback.trim().split(/\s+/).length < 5) issues.push("feedback needs at least a sentence for the student.");
  return issues;
}

/** Sum of awarded marks, rounded to half marks so floating point noise never shows. */
export function totalAwarded(grade: ShortAnswerGrade): number {
  return Math.round(grade.points.reduce((sum, p) => sum + p.awarded, 0) * 2) / 2;
}

export function shortIsCorrect(awarded: number, marks: number): boolean {
  return awarded + EPSILON >= marks * SHORT_CORRECT_FRACTION;
}
