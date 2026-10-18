import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Data model from MOCKBUDDY_SPEC.md section 6.
//
// Row level security is enabled on every table with no policies, so Supabase's
// public Data API (anon / authenticated roles) can read and write nothing. The
// app connects as the `postgres` role through DATABASE_URL, which owns the
// tables and is not subject to RLS.
//
// jsonb column types are placeholders until the Zod schemas in lib/schemas.ts
// exist (phases 2 and 3); they will be replaced by types inferred from those.

export const materialStatus = pgEnum("material_status", ["uploaded", "extracting", "chunked", "failed"]);
export const examDifficulty = pgEnum("exam_difficulty", ["easier", "same", "harder"]);
export const examStatus = pgEnum("exam_status", ["generating", "ready", "graded"]);
export const questionType = pgEnum("question_type", ["mcq", "short", "numerical"]);
export const questionDifficulty = pgEnum("question_difficulty", ["easy", "medium", "hard"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const materials = pgTable(
  "materials",
  {
    id: id(),
    userId: text("user_id").notNull(),
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(),
    pageCount: integer("page_count"),
    status: materialStatus("status").notNull().default("uploaded"),
    createdAt: createdAt(),
  },
  (t) => [index("materials_user_id_idx").on(t.userId)],
).enableRLS();

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    sectionLabel: text("section_label").notNull(),
    topicLabel: text("topic_label"),
    content: text("content").notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chunks_material_ordinal_idx").on(t.materialId, t.ordinal)],
).enableRLS();

export const blueprints = pgTable(
  "blueprints",
  {
    id: id(),
    userId: text("user_id").notNull(),
    sourceFilename: text("source_filename").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    sampleQuestions: jsonb("sample_questions").$type<{ type: string; verbatim_text: string }[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("blueprints_user_created_idx").on(t.userId, t.createdAt)],
).enableRLS();

export const exams = pgTable(
  "exams",
  {
    id: id(),
    blueprintId: uuid("blueprint_id")
      .notNull()
      .references(() => blueprints.id, { onDelete: "cascade" }),
    questionCount: integer("question_count").notNull(),
    difficulty: examDifficulty("difficulty").notNull(),
    status: examStatus("status").notNull().default("generating"),
    usedChunkIds: jsonb("used_chunk_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    generationSeed: integer("generation_seed").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("exams_blueprint_id_idx").on(t.blueprintId)],
).enableRLS();

export const questions = pgTable(
  "questions",
  {
    id: id(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    type: questionType("type").notNull(),
    prompt: text("prompt").notNull(),
    marks: doublePrecision("marks").notNull(),
    options: jsonb("options").$type<string[]>(),
    correctOption: integer("correct_option"),
    optionExplanations:
      jsonb("option_explanations").$type<{ index: number; is_correct: boolean; explanation: string }[]>(),
    correctExplanation: text("correct_explanation").notNull(),
    expectedAnswer: text("expected_answer"),
    rubric: jsonb("rubric").$type<{ point: string; marks: number }[]>(),
    numericAnswer: doublePrecision("numeric_answer"),
    tolerance: doublePrecision("tolerance"),
    unit: text("unit"),
    workedSolution: text("worked_solution").notNull(),
    // Mandatory on every question: the defence against invented content.
    sourceChunkId: uuid("source_chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    sourceExcerpt: text("source_excerpt").notNull(),
    topicLabel: text("topic_label").notNull(),
    difficulty: questionDifficulty("difficulty").notNull(),
  },
  (t) => [uniqueIndex("questions_exam_ordinal_idx").on(t.examId, t.ordinal)],
).enableRLS();

export const answers = pgTable(
  "answers",
  {
    id: id(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    response: text("response").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    awardedMarks: doublePrecision("awarded_marks").notNull(),
    feedback: text("feedback"),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One answer per question: answering reveals the verdict, so there is no re-answer.
  (t) => [uniqueIndex("answers_question_id_idx").on(t.questionId), index("answers_exam_id_idx").on(t.examId)],
).enableRLS();

// Phase 0 connectivity check only: the home page writes and reads these rows.
export const pings = pgTable("pings", {
  id: id(),
  userId: text("user_id").notNull(),
  note: text("note").notNull(),
  createdAt: createdAt(),
}).enableRLS();
