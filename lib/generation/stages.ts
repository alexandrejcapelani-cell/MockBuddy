import "server-only";
import { and, eq, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { type CallMetrics, generateJson, ModelCallError, type PromptMessage, schemaText, withRetryNote } from "@/lib/ai/call";
import type { ApiKey } from "@/lib/api-key";
import { db } from "@/lib/db";
import { exams, generationBatches, questions } from "@/lib/db/schema";
import { RequestError } from "@/lib/http";
import { CritiqueSchema, type CritiqueVerdict, type GeneratedQuestion, SlotQuestionsSchema } from "@/lib/schemas";
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
  critiquePrompt,
  critiqueSystem,
  draftPrompt,
  type ExamContext,
  generationSystem,
  revisePrompt,
  type SlotWithSources,
} from "./prompts";
import { findNearDuplicate } from "./similarity";
import type { BatchStage, DraftSlot, SlotOutcome, SlotVerdict, StageMetrics } from "./types";
import { normalizeQuestion, questionIssues } from "./validate";

// Stage C, one batch at a time. Each call to runNextStage claims the batch, runs exactly
// one model call (draft, draft_retry, critique or revise), saves the result and releases
// the batch, so every request fits the serverless time limit on its own.

/** A claim older than this is treated as abandoned (the request that held it died). */
const STALE_CLAIM = sql`now() - interval '3 minutes'`;
const MAX_CRITIQUE_ATTEMPTS = 2;

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
  /** For this request's model calls only. Never saved with the batch. */
  apiKey: ApiKey;
  metrics: StageMetrics[];
}

type StageResult = Partial<Pick<BatchRow, "stage" | "drafts" | "verdicts" | "outcomes" | "attempts" | "error">>;

export async function runNextStage(
  examId: string,
  batchIndex: number,
  deadlineAt: number | undefined,
  apiKey: ApiKey,
): Promise<BatchView> {
  const exam = await loadExam(examId);
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
    apiKey,
    metrics: [],
  };
  try {
    run.sources = await slotsWithSources(exam.plan.slots.filter((slot) => claimed.slotOrdinals.includes(slot.ordinal)));
    run.existing = await excludedStems(exam, run.context);
    const result = await STAGES[claimed.stage as Exclude<BatchStage, "done" | "failed">](run);
    return batchView(await save(run, result), exam.plan);
  } catch (error) {
    // Release the batch with whatever was measured, then let the route report the error.
    // A retryable model error leaves the stage where it was, so the client can run it again.
    await save(run, {});
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

  // The word-overlap check: a stem too close to an existing one is sent back for revision.
  const automatic = new Map<number, string>();
  const earlier: string[] = [];
  for (const { slot, question } of valid) {
    const duplicate = findNearDuplicate(question.prompt, [...run.existing, ...earlier]);
    if (duplicate) {
      automatic.set(
        slot,
        `Its stem is too close to an existing question ("${duplicate.text.slice(0, 120)}"). Rewrite it to test a different point from the material.`,
      );
    }
    earlier.push(question.prompt);
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
  const response = await callModel(run, "revise", SlotQuestionsSchema, generationSystemPrompt(run), [
    { role: "user", content: revisePrompt(requests, run.existing, run.context.difficulty) },
  ]);
  if ("failed" in response) return response.failed;

  const passed = run.batch.verdicts.filter((v) => v.verdict === "pass").map((v) => run.batch.drafts.find((d) => d.slot === v.slot)!.question!.prompt);
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
  stage: StageMetrics["stage"],
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
      apiKey: run.apiKey,
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

/**
 * Stores the batch's accepted questions (passed critique, or revised and still valid) and
 * marks it done. Everything else in the batch is recorded as dropped.
 */
async function finishBatch(run: StageRun, result: StageResult): Promise<StageResult> {
  const drafts = result.drafts ?? run.batch.drafts;
  const verdicts = result.verdicts ?? run.batch.verdicts;
  const outcomes = [...(result.outcomes ?? run.batch.outcomes)];
  const dropped = new Set(outcomes.filter((o) => o.status === "dropped").map((o) => o.slot));

  const accepted = run.sources.flatMap(({ slot }) => {
    const draft = drafts.find((d) => d.slot === slot.ordinal);
    if (!draft?.question || dropped.has(slot.ordinal)) return [];
    const revised = verdicts.find((v) => v.slot === slot.ordinal)?.verdict === "revise";
    outcomes.push({ slot: slot.ordinal, status: "accepted", revised, reason: null });
    return [{ slot, question: draft.question }];
  });
  for (const ordinal of run.batch.slotOrdinals) {
    if (!outcomes.some((o) => o.slot === ordinal)) {
      outcomes.push({ slot: ordinal, status: "dropped", revised: false, reason: "No valid draft." });
    }
  }

  if (accepted.length > 0) {
    await db().transaction(async (tx) => {
      await tx.insert(questions).values(
        accepted.map(({ slot, question }) => ({
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
      const used = accepted.flatMap(({ slot }) => [slot.chunkId, ...(slot.secondaryChunkId ? [slot.secondaryChunkId] : [])]);
      // One statement, so batches finishing at the same time can't lose each other's chunks.
      await tx
        .update(exams)
        .set({
          usedChunkIds: sql`(select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements(${exams.usedChunkIds} || ${JSON.stringify(used)}::jsonb))`,
        })
        .where(eq(exams.id, run.exam.id));
    });
  }
  return { ...result, drafts, verdicts, outcomes: outcomes.sort((a, b) => a.slot - b.slot), stage: "done" };
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
    .where(eq(generationBatches.id, run.batch.id))
    .returning();
  return saved;
}
