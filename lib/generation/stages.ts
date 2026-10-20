import "server-only";
import { and, asc, eq, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { type CallMetrics, generateJson, ModelCallError, type PromptMessage, schemaText, withRetryNote } from "@/lib/ai/call";
import { db } from "@/lib/db";
import { exams, generationBatches, questions } from "@/lib/db/schema";
import { RequestError } from "@/lib/http";
import { CritiqueSchema, type CritiqueVerdict, type GeneratedQuestion, RepeatCheckSchema, SlotQuestionsSchema } from "@/lib/schemas";
import {
  type BatchRow,
  type BatchView,
  batchView,
  examContext,
  excludedStems,
  type ExamRow,
  loadExam,
  slotsWithSources,
} from "./context";
import {
  answerText,
  critiquePrompt,
  critiqueSystem,
  draftPrompt,
  type ExamContext,
  generationSystem,
  repeatCheckPrompt,
  repeatCheckSystem,
  revisePrompt,
  type SlotWithSources,
} from "./prompts";
import { RunTimedOutError, runDeadline } from "./run-limit";
import { findNearDuplicate, nearDuplicateSlots } from "./similarity";
import type { BatchStage, DraftSlot, PlanSlot, SlotOutcome, SlotVerdict, StageMetrics } from "./types";
import { normalizeQuestion, questionIssues } from "./validate";

// Stage C, one batch at a time. Each call to runNextStage claims the batch, runs exactly
// one model call (draft, draft_retry, critique or revise), saves the result and releases
// the batch, so every request fits the serverless time limit on its own.

/** A claim older than this is treated as abandoned (the request that held it died). */
const STALE_CLAIM = sql`now() - interval '3 minutes'`;
const MAX_CRITIQUE_ATTEMPTS = 2;
/** A model call that fails this close to the run's end failed because the time ran out. */
const RUN_END_MARGIN_MS = 10_000;
/** Repeat checks per save, at most: another runs only if another batch saved during the last one. */
const MAX_REPEAT_CHECKS = 3;

export class BatchBusyError extends Error {
  override name = "BatchBusyError";
  constructor(readonly batch: BatchView) {
    super(`Batch ${batch.batchIndex} is already being worked on.`);
  }
}

interface StageRun {
  batch: BatchRow;
  exam: ExamRow;
  context: ExamContext;
  sources: SlotWithSources[];
  existing: string[];
  deadlineAt: number | undefined;
  metrics: StageMetrics[];
}

type StageResult = Partial<Pick<BatchRow, "stage" | "drafts" | "verdicts" | "outcomes" | "attempts" | "error">>;

/**
 * `requestDeadline` is the serverless limit (Vercel only). The exam's run deadline (3 minutes
 * from the run's start) always applies on top, locally too, so no stage can run past it.
 */
export async function runNextStage(
  examId: string,
  batchIndex: number,
  requestDeadline: number | undefined,
): Promise<BatchView> {
  const exam = await loadExam(examId);
  const runEnds = runDeadline(exam);
  if (Date.now() >= runEnds) throw new RunTimedOutError();
  const deadlineAt = Math.min(runEnds, requestDeadline ?? Number.POSITIVE_INFINITY);
  const [claimed] = await db()
    .update(generationBatches)
    .set({ runningSince: sql`now()` })
    .where(
      and(
        eq(generationBatches.examId, examId),
        eq(generationBatches.batchIndex, batchIndex),
        notInArray(generationBatches.stage, ["done", "failed"]),
        or(isNull(generationBatches.runningSince), lt(generationBatches.runningSince, STALE_CLAIM)),
      ),
    )
    .returning();

  if (!claimed) {
    const [batch] = await db()
      .select()
      .from(generationBatches)
      .where(and(eq(generationBatches.examId, examId), eq(generationBatches.batchIndex, batchIndex)));
    if (!batch) throw new RequestError(`Exam ${examId} has no batch ${batchIndex}.`, 404);
    if (batch.stage === "done" || batch.stage === "failed") return batchView(batch, exam.plan);
    throw new BatchBusyError(batchView(batch, exam.plan));
  }

  const run: StageRun = {
    batch: claimed,
    exam,
    context: await examContext(exam),
    sources: [],
    existing: [],
    deadlineAt,
    metrics: [],
  };
  try {
    run.sources = await slotsWithSources(exam.plan.slots.filter((slot) => claimed.slotOrdinals.includes(slot.ordinal)));
    run.existing = await excludedStems(exam, run.context, claimed.batchIndex);
    const result = await STAGES[claimed.stage as Exclude<BatchStage, "done" | "failed">](run);
    return batchView(await save(run, result), exam.plan);
  } catch (error) {
    // Release the batch with whatever was measured, then let the route report the error.
    // A retryable model error leaves the stage where it was, so the client can run it again,
    // unless the run's time is up: then that is what happened, whatever the model said.
    await save(run, {});
    if (error instanceof ModelCallError && runEnds - Date.now() < RUN_END_MARGIN_MS) {
      throw new RunTimedOutError(error.kind === "deadline" ? "The AI was still working on the next questions." : error.message);
    }
    throw error;
  }
}

const STAGES: Record<Exclude<BatchStage, "done" | "failed">, (run: StageRun) => Promise<StageResult>> = {
  draft: runDraft,
  draft_retry: runDraftRetry,
  critique: runCritique,
  revise: runRevise,
};

// ---------------------------------------------------------------- C1: draft

async function runDraft(run: StageRun): Promise<StageResult> {
  const response = await callModel(run, "draft", SlotQuestionsSchema, generationSystemPrompt(run), [
    { role: "user", content: draftPrompt(run.sources, run.existing, run.context.difficulty) },
  ]);
  if ("failed" in response) return response.failed;

  const drafts = "error" in response
    ? run.sources.map(({ slot }) => ({ slot: slot.ordinal, question: null, rejected: null, issues: [response.error] }))
    : evaluateDrafts(run, run.sources, response.questions);
  const stage: BatchStage = drafts.some((draft) => draft.question === null) ? "draft_retry" : "critique";
  return { drafts, stage };
}

// ---------------------------------------------------------------- C1 retry: failing slots only

async function runDraftRetry(run: StageRun): Promise<StageResult> {
  const failing = run.batch.drafts.filter((draft) => draft.question === null);
  const failingSources = run.sources.filter(({ slot }) => failing.some((draft) => draft.slot === slot.ordinal));
  const previous = JSON.stringify(failing.flatMap((draft) => (draft.rejected ? [{ slot: draft.slot, ...draft.rejected }] : [])), null, 2);
  const messages = withRetryNote(
    [{ role: "user", content: draftPrompt(failingSources, run.existing, run.context.difficulty) }],
    previous,
    failing.flatMap((draft) => draft.issues),
  );
  const response = await callModel(run, "draft_retry", SlotQuestionsSchema, generationSystemPrompt(run), messages);
  if ("failed" in response) return response.failed;

  const retried = "error" in response
    ? failing.map((draft) => ({ ...draft, issues: [response.error] }))
    : evaluateDrafts(run, failingSources, response.questions);
  const drafts = run.batch.drafts.map((draft) => retried.find((r) => r.slot === draft.slot) ?? draft);
  const outcomes: SlotOutcome[] = drafts
    .filter((draft) => draft.question === null)
    .map((draft) => ({ slot: draft.slot, status: "dropped", revised: false, reason: `Failed validation twice: ${draft.issues.join(" ")}` }));

  if (drafts.every((draft) => draft.question === null)) return finishBatch(run, { drafts, outcomes, verdicts: [] });
  return { drafts, outcomes, stage: "critique" };
}

// ---------------------------------------------------------------- C2: critique

async function runCritique(run: StageRun): Promise<StageResult> {
  const valid = validDrafts(run.batch.drafts);
  const attempts = { ...run.batch.attempts, critique: (run.batch.attempts.critique ?? 0) + 1 };

  // The word-overlap check: a stem too close to an existing one (including another batch's
  // draft) or to an earlier one in this batch is sent back for revision.
  const automatic = new Map<number, string>();
  for (const [slot, duplicate] of nearDuplicateSlots(valid.map(({ slot, question }) => ({ slot, prompt: question.prompt })), run.existing)) {
    automatic.set(slot, `Its stem is too close to an existing question ("${duplicate.slice(0, 120)}"). Rewrite it to test a different point from the material.`);
  }

  const reviewed = valid.map(({ slot, question }) => ({ source: sourceFor(run, slot), draft: question }));
  const response = await callModel(
    run,
    "critique",
    CritiqueSchema,
    critiqueSystem(run.context, schemaText(CritiqueSchema)),
    [{ role: "user", content: critiquePrompt(reviewed, run.existing, run.context.difficulty) }],
  );
  if ("failed" in response) return response.failed;

  const returned = "error" in response ? [] : response.verdicts;
  const missing = valid.map((d) => d.slot).filter((slot) => !returned.some((v) => v.slot === slot));
  if (missing.length > 0) {
    const reason = "error" in response ? response.error : `The examiner returned no verdict for slot(s) ${missing.join(", ")}.`;
    if (attempts.critique < MAX_CRITIQUE_ATTEMPTS) return { attempts, error: reason };
    return failBatch(run, `The critique failed twice: ${reason}`, { attempts });
  }

  const verdicts: SlotVerdict[] = valid.map(({ slot }) => toSlotVerdict(slot, returned.find((v) => v.slot === slot)!, automatic.get(slot)));

  if (verdicts.every((verdict) => verdict.verdict === "pass")) {
    return finishBatch(run, { verdicts, attempts, error: null });
  }
  return { verdicts, attempts, error: null, stage: "revise" };
}

/** Any failed check, filler distractor or near-duplicate stem turns a verdict into "revise". */
function toSlotVerdict(slot: number, model: CritiqueVerdict, automatic: string | undefined): SlotVerdict {
  const failedChecks: string[] = [];
  if (!model.answerable_from_material) failedChecks.push("It must be answerable from the supplied material alone.");
  if (!model.single_defensible_answer) failedChecks.push("It must have exactly one defensible answer, and it must match the key.");
  if (model.filler_distractors.length > 0) {
    failedChecks.push(`Replace filler option(s) ${model.filler_distractors.join(", ")} with distractors that each reflect a specific misconception.`);
  }
  if (!model.matches_sample_style) failedChecks.push("Match the sample questions' phrasing conventions and stem length.");
  if (model.duplicates_earlier_question) failedChecks.push("Test a different point from the existing questions.");
  if (automatic) failedChecks.push(automatic);

  if (model.verdict === "pass" && failedChecks.length === 0) return { slot, verdict: "pass", instructions: [] };
  const instructions = dedupe([...(model.instructions ? [model.instructions] : []), ...failedChecks]);
  return { slot, verdict: "revise", instructions: instructions.length > 0 ? instructions : ["Improve the question against every rule."] };
}

// ---------------------------------------------------------------- C3: revise (one round)

async function runRevise(run: StageRun): Promise<StageResult> {
  const toRevise = run.batch.verdicts.filter((verdict) => verdict.verdict === "revise");
  const requests = toRevise.map((verdict) => ({
    source: sourceFor(run, verdict.slot),
    draft: run.batch.drafts.find((draft) => draft.slot === verdict.slot)!.question!,
    instructions: verdict.instructions,
  }));
  // The batch's questions that passed are existing questions too, so a revision doesn't move onto their points.
  const passed = run.batch.verdicts.filter((v) => v.verdict === "pass").map((v) => run.batch.drafts.find((d) => d.slot === v.slot)!.question!.prompt);
  const response = await callModel(run, "revise", SlotQuestionsSchema, generationSystemPrompt(run), [
    { role: "user", content: revisePrompt(requests, [...run.existing, ...passed], run.context.difficulty) },
  ]);
  if ("failed" in response) return response.failed;

  const accepted: string[] = [...passed];
  const drafts = [...run.batch.drafts];
  const outcomes: SlotOutcome[] = [...run.batch.outcomes];

  for (const { source } of requests) {
    const ordinal = source.slot.ordinal;
    let reason: string | null;
    if ("error" in response) {
      reason = response.error;
    } else {
      const evaluated = evaluateDrafts(run, [source], response.questions)[0];
      const duplicate = evaluated.question ? findNearDuplicate(evaluated.question.prompt, [...run.existing, ...accepted]) : null;
      reason = evaluated.question
        ? duplicate
          ? `Still too close to an existing question ("${duplicate.text.slice(0, 80)}").`
          : null
        : evaluated.issues.join(" ");
      if (evaluated.question && !duplicate) {
        accepted.push(evaluated.question.prompt);
        drafts[drafts.findIndex((d) => d.slot === ordinal)] = evaluated;
      }
    }
    if (reason !== null) outcomes.push({ slot: ordinal, status: "dropped", revised: true, reason: `Still failing after revision: ${reason}` });
  }
  return finishBatch(run, { drafts, outcomes });
}

// ---------------------------------------------------------------- shared

type ModelResponse<T> = T | { error: string } | { failed: StageResult };

/**
 * Runs one model call for the stage and records its metrics. Retryable failures and key
 * problems are rethrown (the stage stays put and the client re-runs it); other API errors
 * fail the batch; bad output (invalid JSON, refusal, cut off) comes back as { error } for
 * the stage's own one-retry logic.
 */
async function callModel<S extends z.ZodType>(
  run: StageRun,
  stage: Exclude<StageMetrics["stage"], "repeat_check">,
  schema: S,
  system: string,
  messages: PromptMessage[],
): Promise<ModelResponse<z.output<S>>> {
  const task = ({ draft: "draft", draft_retry: "draft", critique: "critique", revise: "revise" } as const)[stage];
  try {
    const result = await generateJson({
      context: { label: stage, examId: run.exam.id, batch: run.batch.batchIndex },
      schema,
      system,
      messages,
      task,
      deadlineAt: run.deadlineAt,
    });
    run.metrics.push(stageMetrics(stage, result.metrics, "ok"));
    return result.data;
  } catch (error) {
    if (!(error instanceof ModelCallError)) throw error;
    run.metrics.push(stageMetrics(stage, error.metrics, error.kind));
    // Transient failures and key problems leave the stage where it is: once the wait is over
    // or the key is fixed, the client runs the same stage again.
    if (error.retryable || error.keyProblem) throw error;
    if (error.kind === "api") return { failed: failBatch(run, error.message) };
    return { error: error.message };
  }
}

function stageMetrics(stage: StageMetrics["stage"], metrics: CallMetrics, outcome: string): StageMetrics {
  return { stage, ...metrics, outcome };
}

/** The same text for every draft and revise call in an exam, so Gemini's implicit prompt cache can reuse it. */
function generationSystemPrompt(run: StageRun): string {
  return generationSystem(run.context, schemaText(SlotQuestionsSchema));
}

function evaluateDrafts(run: StageRun, sources: SlotWithSources[], returned: (GeneratedQuestion & { slot: number })[]): DraftSlot[] {
  return sources.map(({ slot, primary, secondary }) => {
    const candidate = returned.find((question) => question.slot === slot.ordinal);
    if (!candidate) return { slot: slot.ordinal, question: null, rejected: null, issues: [`slot ${slot.ordinal}: no question was returned for this slot.`] };
    const question = withoutSlot(candidate);
    const issues = questionIssues(question, slot, { primary: primary.content, secondary: secondary?.content ?? null });
    return issues.length === 0
      ? { slot: slot.ordinal, question: normalizeQuestion(question, slot), rejected: null, issues: [] }
      : { slot: slot.ordinal, question: null, rejected: question, issues };
  });
}

function withoutSlot(candidate: GeneratedQuestion & { slot: number }): GeneratedQuestion {
  const question: Partial<typeof candidate> = { ...candidate };
  delete question.slot;
  return question as GeneratedQuestion;
}

function validDrafts(drafts: DraftSlot[]): { slot: number; question: GeneratedQuestion }[] {
  return drafts.flatMap((draft) => (draft.question ? [{ slot: draft.slot, question: draft.question }] : []));
}

function sourceFor(run: StageRun, ordinal: number): SlotWithSources {
  const source = run.sources.find(({ slot }) => slot.ordinal === ordinal);
  if (!source) throw new Error(`Batch ${run.batch.batchIndex} has no slot ${ordinal}.`);
  return source;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function failBatch(run: StageRun, error: string, extra: StageResult = {}): StageResult {
  const outcomes: SlotOutcome[] = run.batch.slotOrdinals.map((slot) => ({ slot, status: "dropped", revised: false, reason: error }));
  return { ...extra, stage: "failed", error, outcomes };
}

interface Candidate {
  slot: PlanSlot;
  question: GeneratedQuestion;
}

/**
 * Stores the batch's accepted questions (passed critique, or revised and still valid) and
 * marks it done. Everything else in the batch is recorded as dropped, and so is a question
 * that repeats one another batch saved first: a top-up batch replaces it. The batch's
 * critique saw the other batches' drafts, but not what changed since (their revisions, or
 * this batch's own), so before saving, the repeat check compares the new questions with
 * the ones other batches saved. The first batch to land has nothing to compare with, so it
 * makes no extra call.
 */
async function finishBatch(run: StageRun, result: StageResult): Promise<StageResult> {
  const drafts = result.drafts ?? run.batch.drafts;
  const verdicts = result.verdicts ?? run.batch.verdicts;
  const outcomes = [...(result.outcomes ?? run.batch.outcomes)];
  const dropped = new Set(outcomes.filter((o) => o.status === "dropped").map((o) => o.slot));
  const wasRevised = (ordinal: number) => verdicts.find((v) => v.slot === ordinal)?.verdict === "revise";
  const drop = (ordinal: number, reason: string) => outcomes.push({ slot: ordinal, status: "dropped", revised: wasRevised(ordinal), reason });

  let candidates: Candidate[] = run.sources.flatMap(({ slot }) => {
    const draft = drafts.find((d) => d.slot === slot.ordinal);
    return draft?.question && !dropped.has(slot.ordinal) ? [{ slot, question: draft.question }] : [];
  });

  const checked = new Set<string>();
  let accepted: Candidate[] = [];
  for (let round = 1; candidates.length > 0; round++) {
    const unchecked = (await savedByOtherBatches(run)).filter((row) => !checked.has(row.id));
    if (unchecked.length > 0) {
      const repeats = await findRepeats(run, candidates, unchecked);
      for (const [ordinal, reason] of repeats) drop(ordinal, reason);
      candidates = candidates.filter(({ slot }) => !repeats.has(slot.ordinal));
      for (const row of unchecked) checked.add(row.id);
      if (candidates.length === 0) break;
    }

    const saved = await db().transaction(async (tx) => {
      // One batch of an exam saves at a time, so two finishing together see each other.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`exam-questions:${run.exam.id}`}))`);
      const rows = await tx.select({ id: questions.id, ordinal: questions.ordinal, prompt: questions.prompt }).from(questions).where(eq(questions.examId, run.exam.id));
      const others = rows.filter((row) => !run.batch.slotOrdinals.includes(row.ordinal));
      // Another batch saved during the repeat check: check against its questions too.
      if (round < MAX_REPEAT_CHECKS && others.some((row) => !checked.has(row.id))) return null;

      // The word-overlap check, which needs no model call, covers the last round.
      const tooClose = nearDuplicateSlots(
        candidates.map(({ slot, question }) => ({ slot: slot.ordinal, prompt: question.prompt })),
        others.map((row) => row.prompt),
      );
      for (const [ordinal, duplicate] of tooClose) drop(ordinal, `Too close to another question in this mock ("${duplicate.slice(0, 80)}").`);
      const kept = candidates.filter(({ slot }) => !tooClose.has(slot.ordinal));
      if (kept.length === 0) return kept;

      await tx.insert(questions).values(
        kept.map(({ slot, question }) => ({
          examId: run.exam.id,
          ordinal: slot.ordinal,
          type: question.type,
          prompt: question.prompt,
          marks: question.marks,
          options: question.options,
          correctOption: question.correct_option,
          optionExplanations: question.option_explanations,
          correctExplanation: question.correct_explanation,
          expectedAnswer: question.expected_answer,
          rubric: question.rubric,
          numericAnswer: question.numeric_answer,
          tolerance: question.tolerance,
          unit: question.unit,
          workedSolution: question.worked_solution,
          sourceChunkId: slot.chunkId,
          sourceExcerpt: question.source_excerpt,
          topicLabel: question.topic_label,
          difficulty: question.difficulty,
        })),
      );
      const used = kept.flatMap(({ slot }) => [slot.chunkId, ...(slot.secondaryChunkId ? [slot.secondaryChunkId] : [])]);
      // One statement, so batches finishing at the same time can't lose each other's chunks.
      await tx
        .update(exams)
        .set({
          usedChunkIds: sql`(select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements(${exams.usedChunkIds} || ${JSON.stringify(used)}::jsonb))`,
        })
        .where(eq(exams.id, run.exam.id));
      return kept;
    });
    if (saved) {
      accepted = saved;
      break;
    }
  }

  for (const { slot } of accepted) {
    outcomes.push({ slot: slot.ordinal, status: "accepted", revised: wasRevised(slot.ordinal), reason: null });
  }
  for (const ordinal of run.batch.slotOrdinals) {
    if (!outcomes.some((o) => o.slot === ordinal)) {
      outcomes.push({ slot: ordinal, status: "dropped", revised: false, reason: "No valid draft." });
    }
  }
  return { ...result, drafts, verdicts, outcomes: outcomes.sort((a, b) => a.slot - b.slot), stage: "done" };
}

/** The questions the exam's other batches have saved. */
async function savedByOtherBatches(run: StageRun) {
  const rows = await db()
    .select({
      id: questions.id,
      ordinal: questions.ordinal,
      type: questions.type,
      prompt: questions.prompt,
      options: questions.options,
      correctOption: questions.correctOption,
      expectedAnswer: questions.expectedAnswer,
      numericAnswer: questions.numericAnswer,
      unit: questions.unit,
    })
    .from(questions)
    .where(eq(questions.examId, run.exam.id))
    .orderBy(asc(questions.ordinal));
  return rows.filter((row) => !run.batch.slotOrdinals.includes(row.ordinal));
}

/**
 * The candidates that repeat one of `saved`, each with the reason to record. If the call
 * fails, the batch saves without it (the word-overlap check still applies) rather than
 * losing the stage's work.
 */
async function findRepeats(run: StageRun, candidates: Candidate[], saved: Awaited<ReturnType<typeof savedByOtherBatches>>): Promise<Map<number, string>> {
  const fresh = candidates.map(({ slot, question }) => ({ number: slot.ordinal, type: question.type, prompt: question.prompt, answer: answerText(question) }));
  const earlier = saved.map((row) => ({
    number: row.ordinal,
    type: row.type,
    prompt: row.prompt,
    answer: answerText({
      type: row.type,
      options: row.options,
      correct_option: row.correctOption,
      expected_answer: row.expectedAnswer,
      numeric_answer: row.numericAnswer,
      unit: row.unit,
    }),
  }));
  let verdicts: z.output<typeof RepeatCheckSchema>["verdicts"];
  try {
    const result = await generateJson({
      context: { label: "repeat_check", examId: run.exam.id, batch: run.batch.batchIndex },
      schema: RepeatCheckSchema,
      system: repeatCheckSystem(schemaText(RepeatCheckSchema)),
      messages: [{ role: "user", content: repeatCheckPrompt(fresh, earlier) }],
      task: "repeatCheck",
      deadlineAt: run.deadlineAt,
    });
    run.metrics.push(stageMetrics("repeat_check", result.metrics, "ok"));
    verdicts = result.data.verdicts;
  } catch (error) {
    if (!(error instanceof ModelCallError)) throw error;
    run.metrics.push(stageMetrics("repeat_check", error.metrics, error.kind));
    return new Map();
  }

  const repeats = new Map<number, string>();
  for (const { slot, repeats: number, same_point } of verdicts) {
    const repeated = saved.find((row) => row.ordinal === number);
    if (!repeated || !candidates.some((candidate) => candidate.slot.ordinal === slot)) continue;
    const point = same_point ? `: ${same_point.trim().replace(/\.$/, "")}` : "";
    repeats.set(slot, `Repeats a question another batch saved first ("${repeated.prompt.slice(0, 80)}")${point}.`);
  }
  return repeats;
}

async function save(run: StageRun, result: StageResult): Promise<BatchRow> {
  const [saved] = await db()
    .update(generationBatches)
    .set({
      ...result,
      metrics: [...run.batch.metrics, ...run.metrics],
      runningSince: null,
      updatedAt: sql`now()`,
    })
    // Only while the batch is still at the stage this request claimed: if the run was stopped
    // meanwhile (batch marked failed), a late result doesn't bring it back.
    .where(and(eq(generationBatches.id, run.batch.id), eq(generationBatches.stage, run.batch.stage)))
    .returning();
  return saved ?? run.batch;
}
