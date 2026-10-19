import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";
import type { DraftSlot, ExamPlan, SlotOutcome, SlotVerdict, StageMetrics } from "../generation/types";
import type { RubricMark } from "../grading/types";
import type { BlueprintSpec, OptionExplanation, RubricPoint, SampleQuestion } from "../schemas";

// Data model from MOCKBUDDY_SPEC.md section 6, with subjects (CHANGES.md 1.4) as the
// container for everything a user makes.
//
// Every row belongs to a Supabase Auth user: tables either have user_id (a foreign key
// to auth.users, deleted with the user) or hang off a table that does.
//
// Row level security is on for every table. Each has one policy: a signed-in user may
// SELECT their own rows (user_id = auth.uid(), directly or through the parent row).
// Nobody else, and nobody signed out (the anon role), can read anything through
// Supabase's public Data API, and nobody can write through it at all: every write goes
// through the app's server, so rules like the free-mock quota can't be skipped.
//
// The server connects as the `postgres` role through DATABASE_URL. That role owns the
// tables, so RLS doesn't apply to it; the server scopes every query to the signed-in
// user itself (lib/auth.ts, lib/ownership.ts).
//
// jsonb column types come from the Zod schemas in lib/schemas.ts.

export const materialStatus = pgEnum("material_status", ["uploaded", "extracting", "chunked", "failed"]);
export const examDifficulty = pgEnum("exam_difficulty", ["easier", "same", "harder"]);
export const examStatus = pgEnum("exam_status", ["generating", "ready", "graded"]);
export const questionType = pgEnum("question_type", ["mcq", "short", "numerical"]);
export const questionDifficulty = pgEnum("question_difficulty", ["easy", "medium", "hard"]);
export const batchKind = pgEnum("batch_kind", ["initial", "topup"]);
export const batchStage = pgEnum("batch_stage", ["draft", "draft_retry", "critique", "revise", "done", "failed"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" });

/** Signed-in users can read their own rows, and only those. */
const readOwnRows = (name: string, ownership: SQL) => pgPolicy(name, { for: "select", to: authenticatedRole, using: ownership });
const OWN_ROW = sql`user_id = (select auth.uid())`;
const ownedThrough = (parent: "materials" | "exams", foreignKey: string) =>
  sql.raw(`exists (select 1 from public.${parent} p where p.id = ${foreignKey} and p.user_id = (select auth.uid()))`);

/** A subject (e.g. "Econometrics"): its material, sample exam, mocks and history belong to it. */
export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("subjects_user_name_idx").on(t.userId, sql`lower(${t.name})`),
    readOwnRows("subjects_select_own", OWN_ROW),
  ],
);

export const materials = pgTable(
  "materials",
  {
    id: id(),
    userId: userId(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(),
    pageCount: integer("page_count"),
    status: materialStatus("status").notNull().default("uploaded"),
    /** Why processing failed, worded for the student; null unless status is "failed". */
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("materials_subject_id_idx").on(t.subjectId), readOwnRows("materials_select_own", OWN_ROW)],
);

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
  (t) => [
    uniqueIndex("chunks_material_ordinal_idx").on(t.materialId, t.ordinal),
    readOwnRows("chunks_select_own", ownedThrough("materials", "material_id")),
  ],
);

export const blueprints = pgTable(
  "blueprints",
  {
    id: id(),
    userId: userId(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    sourceFilename: text("source_filename").notNull(),
    /** Where the uploaded sample exam is stored. It is never chunked into the material pool. */
    storagePath: text("storage_path").notNull(),
    spec: jsonb("spec").$type<BlueprintSpec>().notNull(),
    /** Questions copied verbatim from the sample exam: few-shot examples and permanent exclusions. */
    sampleQuestions: jsonb("sample_questions").$type<SampleQuestion[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("blueprints_subject_created_idx").on(t.subjectId, t.createdAt), readOwnRows("blueprints_select_own", OWN_ROW)],
);

export const exams = pgTable(
  "exams",
  {
    id: id(),
    userId: userId(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    blueprintId: uuid("blueprint_id")
      .notNull()
      .references(() => blueprints.id, { onDelete: "cascade" }),
    /** The exam this one regenerates; its question stems are excluded and its chunks ranked last. */
    parentExamId: uuid("parent_exam_id").references((): AnyPgColumn => exams.id, { onDelete: "set null" }),
    questionCount: integer("question_count").notNull(),
    difficulty: examDifficulty("difficulty").notNull(),
    status: examStatus("status").notNull().default("generating"),
    usedChunkIds: jsonb("used_chunk_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    generationSeed: integer("generation_seed").notNull(),
    plan: jsonb("plan").$type<ExamPlan>().notNull(),
    /**
     * When the current generation run started (creation, or the last Retry). A run gets
     * GENERATION_RUN_LIMIT_MS from here; null on rows from before the limit means created_at.
     */
    runStartedAt: timestamp("run_started_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("exams_user_created_idx").on(t.userId, t.createdAt),
    index("exams_subject_id_idx").on(t.subjectId),
    readOwnRows("exams_select_own", OWN_ROW),
  ],
);

/**
 * One batch of up to 5 slots moving through draft → critique → revise. Each stage runs in
 * its own request, so this row carries the state between them.
 */
export const generationBatches = pgTable(
  "generation_batches",
  {
    id: id(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    batchIndex: integer("batch_index").notNull(),
    kind: batchKind("kind").notNull(),
    slotOrdinals: jsonb("slot_ordinals").$type<number[]>().notNull(),
    stage: batchStage("stage").notNull().default("draft"),
    /** How many times each stage has been attempted. */
    attempts: jsonb("attempts").$type<Partial<Record<string, number>>>().notNull().default(sql`'{}'::jsonb`),
    drafts: jsonb("drafts").$type<DraftSlot[]>().notNull().default(sql`'[]'::jsonb`),
    verdicts: jsonb("verdicts").$type<SlotVerdict[]>().notNull().default(sql`'[]'::jsonb`),
    outcomes: jsonb("outcomes").$type<SlotOutcome[]>().notNull().default(sql`'[]'::jsonb`),
    metrics: jsonb("metrics").$type<StageMetrics[]>().notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    /** Set while a request is running a stage, so two requests never run the same batch at once. */
    runningSince: timestamp("running_since", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("generation_batches_exam_batch_idx").on(t.examId, t.batchIndex),
    readOwnRows("generation_batches_select_own", ownedThrough("exams", "exam_id")),
  ],
);

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
    optionExplanations: jsonb("option_explanations").$type<OptionExplanation[]>(),
    correctExplanation: text("correct_explanation").notNull(),
    expectedAnswer: text("expected_answer"),
    rubric: jsonb("rubric").$type<RubricPoint[]>(),
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
  (t) => [
    uniqueIndex("questions_exam_ordinal_idx").on(t.examId, t.ordinal),
    readOwnRows("questions_select_own", ownedThrough("exams", "exam_id")),
  ],
);

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
    /** For short answers: the marks awarded per rubric point, with the marker's reason. */
    rubricMarks: jsonb("rubric_marks").$type<RubricMark[]>(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One answer per question: answering reveals the verdict, so there is no re-answer.
  (t) => [
    uniqueIndex("answers_question_id_idx").on(t.questionId),
    index("answers_exam_id_idx").on(t.examId),
    readOwnRows("answers_select_own", ownedThrough("exams", "exam_id")),
  ],
);
