import { z } from "zod";

// Zod schemas for every model response (MOCKBUDDY_SPEC.md section 8). Types are derived
// from them, and the same schemas drive the API's structured output and the prompts.
// Rules JSON Schema can't express (lengths, cross-field checks) live in the validators
// next to each caller.

// ---------------------------------------------------------------- topic labels

export const TopicLabelsSchema = z.object({
  labels: z.array(
    z.object({
      index: z.number().int(),
      topic_label: z.string(),
    }),
  ),
});
export type TopicLabels = z.infer<typeof TopicLabelsSchema>;

// ---------------------------------------------------------------- blueprint

export const QuestionTypeSchema = z.enum(["mcq", "short", "numerical"]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const LevelSchema = z.enum(["easy", "medium", "hard"]);
export type Level = z.infer<typeof LevelSchema>;

export const BlueprintSectionSchema = z.object({
  name: z.string(),
  question_type: QuestionTypeSchema,
  proportion: z.number(),
  marks_each: z.number(),
  style_notes: z.string(),
  observed_difficulty: LevelSchema,
});
export type BlueprintSection = z.infer<typeof BlueprintSectionSchema>;

export const SampleQuestionSchema = z.object({
  type: QuestionTypeSchema,
  verbatim_text: z.string(),
});
export type SampleQuestion = z.infer<typeof SampleQuestionSchema>;

export const BlueprintSchema = z.object({
  duration_minutes: z.number().nullable(),
  instructions_style: z.string(),
  tone_notes: z.string(),
  sections: z.array(BlueprintSectionSchema),
  sample_questions: z.array(SampleQuestionSchema),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

/** What `blueprints.spec` stores: the blueprint without its sample questions, which have their own column. */
export type BlueprintSpec = Omit<Blueprint, "sample_questions">;

// ---------------------------------------------------------------- generated questions

export const OptionExplanationSchema = z.object({
  index: z.number().int(),
  is_correct: z.boolean(),
  explanation: z.string(),
});
export type OptionExplanation = z.infer<typeof OptionExplanationSchema>;

export const RubricPointSchema = z.object({
  point: z.string(),
  marks: z.number(),
});
export type RubricPoint = z.infer<typeof RubricPointSchema>;

export const GeneratedQuestionSchema = z.object({
  type: QuestionTypeSchema,
  prompt: z.string(),
  marks: z.number(),
  options: z.array(z.string()).nullable(),
  correct_option: z.number().int().nullable(),
  option_explanations: z.array(OptionExplanationSchema).nullable(),
  correct_explanation: z.string(),
  expected_answer: z.string().nullable(),
  rubric: z.array(RubricPointSchema).nullable(),
  numeric_answer: z.number().nullable(),
  tolerance: z.number().nullable(),
  unit: z.string().nullable(),
  worked_solution: z.string(),
  source_excerpt: z.string(),
  topic_label: z.string(),
  difficulty: LevelSchema,
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

/** One question per slot: the draft and revise calls return these. */
export const SlotQuestionsSchema = z.object({
  questions: z.array(GeneratedQuestionSchema.extend({ slot: z.number().int() })),
});
export type SlotQuestions = z.infer<typeof SlotQuestionsSchema>;

export const CritiqueSchema = z.object({
  verdicts: z.array(
    z.object({
      slot: z.number().int(),
      answerable_from_material: z.boolean(),
      single_defensible_answer: z.boolean(),
      /** Option indexes that are obvious filler rather than a specific misconception. */
      filler_distractors: z.array(z.number().int()),
      matches_sample_style: z.boolean(),
      duplicates_earlier_question: z.boolean(),
      verdict: z.enum(["pass", "revise"]),
      instructions: z.string().nullable(),
    }),
  ),
});
export type Critique = z.infer<typeof CritiqueSchema>;
export type CritiqueVerdict = Critique["verdicts"][number];

/** The repeat check when a batch saves: for each new question, the saved question it repeats, if any. */
export const RepeatCheckSchema = z.object({
  verdicts: z.array(
    z.object({
      slot: z.number().int(),
      /** The number of the saved question it tests the same point as; null if none. */
      repeats: z.number().int().nullable(),
      /** The point both test, when it repeats one. */
      same_point: z.string().nullable(),
    }),
  ),
});

// ---------------------------------------------------------------- marking (stage D)

/** Short-answer marking: marks per rubric point, in rubric order. */
export const ShortAnswerGradeSchema = z.object({
  points: z.array(
    z.object({
      index: z.number().int(),
      awarded: z.number(),
      reason: z.string(),
    }),
  ),
  feedback: z.string(),
});
export type ShortAnswerGrade = z.infer<typeof ShortAnswerGradeSchema>;

/** Numerical answers the parser couldn't read: does the response state the right quantity? */
export const NumericJudgementSchema = z.object({
  is_correct: z.boolean(),
  understood_value: z.number().nullable(),
  feedback: z.string(),
});
export type NumericJudgement = z.infer<typeof NumericJudgementSchema>;
