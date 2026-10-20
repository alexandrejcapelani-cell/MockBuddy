import type { BlueprintSection, Level } from "../schemas.ts";

// The question-format control at the table: MCQ only, open-ended only (short answers and
// calculations, both typed), or mixed, which follows the sample exam's own mix. The plan is
// built from the sample's sections, so a format just chooses which of them to plan from.

export const QUESTION_FORMATS = ["mcq", "open", "mixed"] as const;
export type QuestionFormat = (typeof QUESTION_FORMATS)[number];

export const FORMAT_NAMES: Record<QuestionFormat, string> = {
  mcq: "MCQ only",
  open: "Open-ended only",
  mixed: "Mixed",
};

const isMcq = (section: BlueprintSection) => section.question_type === "mcq";

/**
 * The sample's sections to plan from for this format (shares are renormalized when slots
 * are allocated). If the sample has no section of the wanted kind, one stand-in section
 * written in the paper's tone takes its place.
 */
export function sectionsForFormat(sections: BlueprintSection[], format: QuestionFormat): BlueprintSection[] {
  if (format === "mixed") return sections;
  const wanted = sections.filter((section) => (format === "mcq" ? isMcq(section) : !isMcq(section)));
  return wanted.length > 0 ? wanted : [standInSection(sections, format)];
}

function standInSection(sections: BlueprintSection[], format: "mcq" | "open"): BlueprintSection {
  const difficulty = mostCommon(sections.map((section) => section.observed_difficulty)) ?? "medium";
  return format === "mcq"
    ? {
        name: "Multiple choice",
        question_type: "mcq",
        proportion: 1,
        marks_each: 2,
        style_notes:
          "Multiple choice with four options, one correct, in the same tone and register as the paper's other questions. Each wrong option reflects a specific misconception.",
        observed_difficulty: difficulty,
      }
    : {
        name: "Short answer",
        question_type: "short",
        proportion: 1,
        marks_each: 5,
        style_notes:
          "Short written answers in the same tone and register as the paper's other questions: explain, compare or apply an idea from the material in a few sentences.",
        observed_difficulty: difficulty,
      };
}

/** For the control's note: what share of the sample's questions are multiple choice. */
export function sampleMix(sections: BlueprintSection[]): { mcqShare: number; hasMcq: boolean; hasOpen: boolean } {
  const total = sections.reduce((sum, section) => sum + section.proportion, 0);
  const mcq = sections.filter(isMcq).reduce((sum, section) => sum + section.proportion, 0);
  return { mcqShare: total > 0 ? mcq / total : 0, hasMcq: sections.some(isMcq), hasOpen: sections.some((s) => !isMcq(s)) };
}

function mostCommon(levels: Level[]): Level | null {
  const counts = new Map<Level, number>();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
