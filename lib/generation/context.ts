import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { blueprints, chunks, exams, generationBatches, questions } from "@/lib/db/schema";
import { RequestError } from "@/lib/http";
import type { ExamContext, SlotWithSources } from "./prompts";
import type { PlanSlot, StageMetrics } from "./types";

// Loading what the generation stages need, and the progress view the client polls.

export type ExamRow = typeof exams.$inferSelect;
export type BatchRow = typeof generationBatches.$inferSelect;

const MAX_EXCLUDED_STEMS = 60;
const MAX_STEM_CHARS = 300;
/** How far back a regeneration chain is followed for excluded stems and used chunks. */
const MAX_CHAIN_DEPTH = 5;

export async function loadExam(examId: string): Promise<ExamRow> {
  const [exam] = await db().select().from(exams).where(eq(exams.id, examId));
  if (!exam) throw new RequestError("That exam doesn't exist.", 404);
  return exam;
}

export async function examContext(exam: ExamRow): Promise<ExamContext> {
  const [blueprint] = await db().select().from(blueprints).where(eq(blueprints.id, exam.blueprintId));
  return { spec: blueprint.spec, sampleQuestions: blueprint.sampleQuestions, difficulty: exam.difficulty };
}

export async function slotsWithSources(slots: PlanSlot[]): Promise<SlotWithSources[]> {
  const ids = [...new Set(slots.flatMap((slot) => [slot.chunkId, ...(slot.secondaryChunkId ? [slot.secondaryChunkId] : [])]))];
  const rows = await db()
    .select({ id: chunks.id, sectionLabel: chunks.sectionLabel, content: chunks.content })
    .from(chunks)
    .where(inArray(chunks.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return slots.map((slot) => {
    const primary = byId.get(slot.chunkId);
    if (!primary) {
      throw new RequestError(`The material for question ${slot.ordinal} has been removed. Generate a new mock.`, 409);
    }
    const secondary = slot.secondaryChunkId ? (byId.get(slot.secondaryChunkId) ?? null) : null;
    return { slot, primary, secondary };
  });
}

/** Ids of the exam's ancestors in its regeneration chain, nearest first. */
export async function ancestorExamIds(exam: ExamRow): Promise<string[]> {
  const ids: string[] = [];
  let parentId = exam.parentExamId;
  while (parentId && ids.length < MAX_CHAIN_DEPTH) {
    ids.push(parentId);
    const [parent] = await db().select({ parentExamId: exams.parentExamId }).from(exams).where(eq(exams.id, parentId));
    parentId = parent?.parentExamId ?? null;
  }
  return ids;
}

/**
 * Question stems every new question must stay clear of: the sample exam's questions
 * (always), stems from earlier exams in the regeneration chain, and this exam's own
 * accepted questions.
 */
export async function excludedStems(exam: ExamRow, context: ExamContext): Promise<string[]> {
  const ancestors = await ancestorExamIds(exam);
  const examIds = [exam.id, ...ancestors];
  const rows = await db()
    .select({ prompt: questions.prompt })
    .from(questions)
    .where(inArray(questions.examId, examIds))
    .orderBy(asc(questions.ordinal));
  const stems = [...context.sampleQuestions.map((sample) => sample.verbatim_text), ...rows.map((row) => row.prompt)];
  return stems.slice(0, MAX_EXCLUDED_STEMS).map((stem) => (stem.length > MAX_STEM_CHARS ? `${stem.slice(0, MAX_STEM_CHARS)}…` : stem));
}

export interface BatchView {
  batchIndex: number;
  kind: BatchRow["kind"];
  stage: BatchRow["stage"];
  slots: { ordinal: number; type: PlanSlot["type"]; topicLabel: string }[];
  outcomes: BatchRow["outcomes"];
  error: string | null;
  metrics: StageMetrics[];
}

export function batchView(batch: BatchRow, plan: ExamRow["plan"]): BatchView {
  const slots = plan.slots
    .filter((slot) => batch.slotOrdinals.includes(slot.ordinal))
    .map((slot) => ({ ordinal: slot.ordinal, type: slot.type, topicLabel: slot.topicLabel }));
  return {
    batchIndex: batch.batchIndex,
    kind: batch.kind,
    stage: batch.stage,
    slots,
    outcomes: batch.outcomes,
    error: batch.error,
    metrics: batch.metrics,
  };
}

export interface ExamProgress {
  examId: string;
  status: ExamRow["status"];
  questionCount: number;
  difficulty: ExamRow["difficulty"];
  generated: number;
  batches: BatchView[];
}

export async function examProgress(examId: string): Promise<ExamProgress> {
  const exam = await loadExam(examId);
  const batches = await db()
    .select()
    .from(generationBatches)
    .where(eq(generationBatches.examId, examId))
    .orderBy(asc(generationBatches.batchIndex));
  const generated = await db().$count(questions, eq(questions.examId, examId));
  return {
    examId,
    status: exam.status,
    questionCount: exam.questionCount,
    difficulty: exam.difficulty,
    generated,
    batches: batches.map((batch) => batchView(batch, exam.plan)),
  };
}
