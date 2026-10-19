import type { RubricPoint } from "../schemas.ts";

// Prompts for stage D: marking a short answer against its rubric, and judging a numerical
// answer the parser couldn't read.

export const SHORT_GRADING_SYSTEM = `You mark a student's answer to a practice exam question against its rubric. Mark generously, like a fair examiner who wants to reward understanding:
- Award each rubric point when its idea is clearly present in the answer, even if the wording is loose, informal, or ordered differently from the model answer.
- Never withhold marks over phrasing, spelling or notation when the substance is right.
- Award part of a point's marks when the idea is partly there; award nothing for a point that is missing or wrong.
- Judge only what the student wrote. Don't credit ideas they didn't express.

For each rubric point, in rubric order, give the marks awarded (from 0 to that point's marks) and a short reason. Then write feedback addressed to the student in one to three sentences: what they got right, and what was missing or wrong.

Reply with a JSON object only: no prose, no code fences.`;

export function shortGradingPrompt(input: {
  prompt: string;
  expectedAnswer: string;
  rubric: RubricPoint[];
  response: string;
  schema: string;
}): string {
  const rubric = input.rubric.map((point, index) => `${index}. (${point.marks} marks) ${point.point}`).join("\n");
  return `<question>\n${input.prompt}\n</question>

<model_answer>\n${input.expectedAnswer}\n</model_answer>

<rubric>\n${rubric}\n</rubric>

<student_answer>\n${input.response}\n</student_answer>

Mark the student's answer. One entry per rubric point, with "index" as numbered above. The JSON must match this schema:
${input.schema}`;
}

export const NUMERIC_JUDGE_SYSTEM = `You check a student's answer to a numerical exam question when it couldn't be read as a single number automatically. Decide whether the answer states the correct quantity, within the stated tolerance. Accept any clear way of writing it: words, fractions, scientific notation, a short expression with its result, or a value with its unit. If the answer gives several different final values, or no final value, it is not correct.

Set understood_value to the final value you read from the answer, or null if there is none. Write feedback to the student in one or two sentences.

Reply with a JSON object only: no prose, no code fences.`;

export function numericJudgePrompt(input: {
  prompt: string;
  answer: number;
  tolerance: number;
  unit: string | null;
  response: string;
  schema: string;
}): string {
  return `<question>\n${input.prompt}\n</question>

<correct_answer value="${input.answer}" tolerance="${input.tolerance}" unit="${input.unit ?? ""}" />

<student_answer>\n${input.response}\n</student_answer>

The JSON must match this schema:
${input.schema}`;
}
