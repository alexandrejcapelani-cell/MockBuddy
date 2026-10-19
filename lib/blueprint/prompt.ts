// Prompt for stage B: one call over the sample exam's text that returns the blueprint and
// 3–5 verbatim sample questions.

export const BLUEPRINT_SYSTEM = `You study one past exam paper and describe its style precisely, so that new questions can be written that a student would recognise as coming from the same exam.

Produce a blueprint of the paper:

- duration_minutes: the time allowed if the paper states it, otherwise null.
- instructions_style: how the paper words its rubric and instructions. Quote short characteristic phrases.
- tone_notes: the phrasing conventions of the questions. Cover each of these explicitly: grammatical person and verb forms in stems (for example "Which of the following…", imperatives such as "Explain…" or "State…"); whether stems open with a scenario or context sentence; the typical stem length in words, as a number range; how options are written (full sentences or fragments, parallel structure, relative length, labels such as (a)–(d)); how calculations are asked for (units, decimal places, "show your working").
- sections: one entry per section of the paper, in order. question_type is "mcq" (choose from given options), "short" (a written answer or explanation, marked against points) or "numerical" (a single numeric answer). If a section mixes types, give one entry per type, in the order they appear, each with the section's name. proportion is that entry's share of all questions in the paper, counted by number of questions, so the proportions sum to 1. marks_each is the marks per question in that entry (the average if they vary). style_notes describe that entry's questions specifically: the number of options, what the questions ask for (recalling a definition, applying a principle to a scenario, interpreting a result, computing a quantity), and any recurring pattern. observed_difficulty is "easy", "medium" or "hard" for an undergraduate course.
- sample_questions: 3 to 5 complete questions copied verbatim from the paper, exactly as they appear in the text, including the question number, the whole stem and every option with its label. Choose them so every question type in the paper is represented. Do not fix typos, reword or reformat anything. The text was extracted from a PDF, so you may join broken lines with single spaces, but change nothing else. If the paper has fewer than 3 questions, copy all of them.

Reply with a JSON object only: no prose, no code fences.`;

export function blueprintPrompt(paperText: string, filename: string, schema: string): string {
  return `<paper filename="${filename.replace(/"/g, "'")}">\n${paperText}\n</paper>\n\nDescribe this paper as a blueprint. The JSON must match this schema:\n${schema}`;
}
