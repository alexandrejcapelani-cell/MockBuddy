import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { activeBlueprint } from "@/lib/blueprint/extract-blueprint";
import { db } from "@/lib/db";
import { blueprints, chunks, exams, generationBatches, materials, questions } from "@/lib/db/schema";
import { RequestError } from "@/lib/http";
import { ADMIN_TOPIC } from "@/lib/ingest/topic-labels";
import type { BlueprintSection } from "@/lib/schemas";
import { ancestorExamIds, loadExam } from "./context";
import { BATCH_SIZE, batchOrdinals, buildPlan, type PlannableChunk, selectChunks, slotFor } from "./plan";
import type { ExamDifficulty, PlanSlot } from "./types";

// Exam-level steps of stage C: create an exam and its batches, top up dropped questions,
// and finalize. The client drives them; the batches themselves run in stages.ts.

/** At most this many extra batches replace dropped questions; after that the exam ships short. */
export const MAX_TOPUP_BATCHES = 2;

export const QUESTION_COUNTS = [5, 10, 15, 20] as const;

export async function createExam(input: {
  userId: string;
  questionCount: (typeof QUESTION_COUNTS)[number];
  difficulty: ExamDifficulty;
  parentExamId?: string;
}): Promise<{ examId: string; batches: number }> {
  const blueprint = await activeBlueprint(input.userId);
  if (!blueprint) throw new RequestError("Upload a sample exam first: generation needs its blueprint.", 409);
  const pool = await plannableChunks(input.userId);
  if (pool.length === 0) throw new RequestError("Add some material first: there are no labelled chunks to write questions from.", 409);

  const parent = input.parentExamId ? await loadExam(input.parentExamId) : null;
  const avoid = new Set<string>(parent ? await chainUsedChunks(parent) : []);
  const seed = randomInt(1, 2 ** 31 - 1);
  const plan = buildPlan({
    sections: blueprint.spec.sections,
    chunks: pool,
    questionCount: input.questionCount,
    harder: input.difficulty === "harder",
    seed,
    avoidChunkIds: avoid,
  });

  const examId = await db().transaction(async (tx) => {
    const [exam] = await tx
      .insert(exams)
      .values({
        blueprintId: blueprint.id,
        parentExamId: parent?.id ?? null,
        questionCount: input.questionCount,
        difficulty: input.difficulty,
        status: "generating",
        generationSeed: seed,
        plan,
      })
      .returning({ id: exams.id });
    await tx.insert(generationBatches).values(
      batchOrdinals(plan.slots).map((slotOrdinals, batchIndex) => ({ examId: exam.id, batchIndex, kind: "initial" as const, slotOrdinals })),
    );
    return exam.id;
  });
  return { examId, batches: Math.ceil(plan.slots.length / BATCH_SIZE) };
}

/** Labelled chunks from processed material, minus non-teaching chunks. */
async function plannableChunks(userId: string): Promise<PlannableChunk[]> {
  const rows = await db()
    .select({ id: chunks.id, topicLabel: chunks.topicLabel, ordinal: chunks.ordinal, materialId: chunks.materialId })
    .from(chunks)
    .innerJoin(materials, eq(chunks.materialId, materials.id))
    .where(
      and(
        eq(materials.userId, userId),
        eq(materials.status, "chunked"),
        isNotNull(chunks.topicLabel),
        ne(chunks.topicLabel, ADMIN_TOPIC),
      ),
    )
    .orderBy(asc(materials.createdAt), asc(chunks.ordinal));
  const materialOrder = new Map<string, number>();
  for (const row of rows) if (!materialOrder.has(row.materialId)) materialOrder.set(row.materialId, materialOrder.size);
  return rows.map((row) => ({
    id: row.id,
    topicLabel: row.topicLabel!,
    ordinal: row.ordinal,
    materialOrder: materialOrder.get(row.materialId)!,
  }));
}

async function chainUsedChunks(exam: typeof exams.$inferSelect): Promise<string[]> {
  const ids = [exam.id, ...(await ancestorExamIds(exam))];
  const rows = await Promise.all(ids.map((id) => db().select({ used: exams.usedChunkIds }).from(exams).where(eq(exams.id, id))));
  return rows.flatMap(([row]) => row?.used ?? []);
}

export type TopupResult =
  | { status: "created"; batchIndex: number; slots: number }
  | { status: "not_needed" }
  | { status: "limit_reached"; short: number }
  | { status: "pending" };

/**
 * If questions were dropped and fewer than MAX_TOPUP_BATCHES top-ups have run, adds one
 * batch of replacement slots: same types and sections as the dropped ones, drawn from
 * chunks this exam hasn't used (and not the dropped slots' chunks).
 */
export async function requestTopup(examId: string): Promise<TopupResult> {
  // Read outside the transaction: inside it, every query must go through `tx` (locally the
  // app has a single database connection, which the transaction holds).
  const [owner] = await db()
    .select({ userId: blueprints.userId })
    .from(exams)
    .innerJoin(blueprints, eq(exams.blueprintId, blueprints.id))
    .where(eq(exams.id, examId));
  if (!owner) throw new RequestError("That exam doesn't exist.", 404);
  const pool = await plannableChunks(owner.userId);

  return db().transaction(async (tx) => {
    const [exam] = await tx.select().from(exams).where(eq(exams.id, examId)).for("update");
    if (!exam) throw new RequestError("That exam doesn't exist.", 404);
    if (exam.status !== "generating") return { status: "not_needed" };

    const batches = await tx.select().from(generationBatches).where(eq(generationBatches.examId, examId));
    if (batches.some((batch) => batch.stage !== "done" && batch.stage !== "failed")) return { status: "pending" };

    const accepted = await tx.$count(questions, eq(questions.examId, examId));
    const deficit = exam.questionCount - accepted;
    if (deficit <= 0) return { status: "not_needed" };
    const topups = batches.filter((batch) => batch.kind === "topup").length;
    if (topups >= MAX_TOPUP_BATCHES) return { status: "limit_reached", short: deficit };

    const replaced = new Set(exam.plan.slots.flatMap((slot) => (slot.replacesSlot === null ? [] : [slot.replacesSlot])));
    const dropped = batches
      .flatMap((batch) => batch.outcomes)
      .filter((outcome) => outcome.status === "dropped" && !replaced.has(outcome.slot))
      .map((outcome) => exam.plan.slots.find((slot) => slot.ordinal === outcome.slot)!)
      .sort((a, b) => a.ordinal - b.ordinal)
      .slice(0, Math.min(deficit, BATCH_SIZE));
    if (dropped.length === 0) return { status: "limit_reached", short: deficit };

    const avoid = new Set([...exam.usedChunkIds, ...dropped.flatMap((slot) => [slot.chunkId, ...(slot.secondaryChunkId ? [slot.secondaryChunkId] : [])])]);
    const picks = selectChunks(pool, dropped.length, {
      seed: exam.generationSeed + 7_919 * (topups + 1),
      avoid,
      withSecondary: exam.difficulty === "harder",
    });
    const nextOrdinal = Math.max(...exam.plan.slots.map((slot) => slot.ordinal)) + 1;
    const newSlots: PlanSlot[] = dropped.map((slot, i) => slotFor(nextOrdinal + i, sectionOf(slot), picks[i], slot.ordinal));

    const batchIndex = Math.max(...batches.map((batch) => batch.batchIndex)) + 1;
    await tx.update(exams).set({ plan: { ...exam.plan, slots: [...exam.plan.slots, ...newSlots] } }).where(eq(exams.id, examId));
    await tx.insert(generationBatches).values({
      examId,
      batchIndex,
      kind: "topup",
      slotOrdinals: newSlots.map((slot) => slot.ordinal),
    });
    return { status: "created", batchIndex, slots: newSlots.length };
  });
}

function sectionOf(slot: PlanSlot): BlueprintSection {
  return {
    name: slot.sectionName,
    question_type: slot.type,
    proportion: 0,
    marks_each: slot.marks,
    style_notes: slot.styleNotes,
    observed_difficulty: slot.observedDifficulty,
  };
}

/**
 * Called once every batch has finished: renumbers the questions 1..n in plan order and
 * marks the exam ready. Returns how many questions it has and how many are missing.
 */
export async function finalizeExam(examId: string): Promise<{ requested: number; generated: number; short: number }> {
  return db().transaction(async (tx) => {
    const [exam] = await tx.select().from(exams).where(eq(exams.id, examId)).for("update");
    if (!exam) throw new RequestError("That exam doesn't exist.", 404);
    const batches = await tx.select({ stage: generationBatches.stage }).from(generationBatches).where(eq(generationBatches.examId, examId));
    if (batches.some((batch) => batch.stage !== "done" && batch.stage !== "failed")) {
      throw new RequestError("Some batches are still generating.", 409);
    }
    if (exam.status === "generating") {
      // Two passes, because questions(exam_id, ordinal) is unique at every step.
      await tx.execute(sql`update questions set ordinal = -ordinal where exam_id = ${examId}`);
      await tx.execute(sql`
        update questions q set ordinal = r.n
        from (select id, row_number() over (order by -ordinal) as n from questions where exam_id = ${examId}) r
        where q.id = r.id`);
      await tx.update(exams).set({ status: "ready" }).where(eq(exams.id, examId));
    }
    const generated = await tx.$count(questions, eq(questions.examId, examId));
    return { requested: exam.questionCount, generated, short: Math.max(0, exam.questionCount - generated) };
  });
}
