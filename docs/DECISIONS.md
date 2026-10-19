# Decisions

Agreed on 2026-10-18 after the spec review, updated since. Where this file and
[MOCKBUDDY_SPEC.md](../MOCKBUDDY_SPEC.md) disagree, this file wins.

## Local-first development (2026-10-19)

- MockBuddy runs locally for now. **Supabase, GitHub and Vercel are deferred until after
  phase 5.** This replaces the earlier plan to deploy before phase 3 tuning.
- Database: an embedded Postgres (PGlite) that `npm run dev` starts, persisted in
  `.data/pglite`, with migrations applied on start. The app reaches it through the same
  postgres-js driver and `DATABASE_URL` it will use for Supabase, so moving to Supabase is
  setting `DATABASE_URL`.
- File storage sits behind the `FileStorage` interface (`lib/storage/types.ts`). The local
  adapter keeps files in `.data/uploads` and issues signed upload URLs to
  `/api/local-upload`, a stand-in for Supabase Storage that only writes bytes to disk. The
  browser flow is the same for both: get an upload target, PUT the bytes to it, send only
  the storage path to the backend. Moving to Supabase Storage is adding
  `lib/storage/supabase.ts` and changing the one line in `lib/storage/index.ts`.
- The only environment variable is `ANTHROPIC_API_KEY`. Everything else has a local default.
- No `APP_PASSPHRASE` or middleware while local (see Access).
- Each phase ends with build, typecheck, lint and tests passing and a local commit. There
  are no deployment checks between phases.
- **The 60 s serverless timeout must be validated on Vercel before deploying.** Nothing
  enforces it locally, so every AI request logs its duration and warns when it passes
  60 s. On Vercel (`VERCEL=1`) each request stops itself at 55 s with a retryable error.
  Timings measured locally are indicative only. Known risks to check first: the blueprint
  route can make two model calls in one request (its validation retry), and topic
  labelling makes one call per 20 chunks in one request, so a very large file could need
  splitting into separate requests.

## Generation pipeline

- Draft, critique and revise stay three separate model calls. Each runs in its own HTTP
  request (`/api/generate` with a `stage`), with the state between stages saved in the
  database. Every AI route keeps `maxDuration = 60`.
- Batches of 5 run **in parallel** from the client, 4 at a time to start with (see Rate
  limits). `exams.plan` assigns every slot its type, section, marks and chunk(s) up front,
  so batches don't depend on each other. For the wall-clock target, see Timing.
- Consequence, accepted: the draft call doesn't see stems from other batches of the same
  exam. Cross-batch dedup relies on chunk rotation, a server-side word-overlap check and
  the critique pass. Stems from the previous exam chain and the sample exam are still
  passed in as exclusions.
- Dropped questions (failed validation twice, or still failing after revise) are replaced
  by at most 2 extra batches, each through the full pipeline and drawn from unused chunks.
  If the exam is still short, it ships short and the UI says so.
- No `temperature` parameter: Sonnet 5.5 rejects non-default values, and 1.0 is the
  default. Variety comes from the seed offset, the exclusions and chunk choice. Reasoning
  effort is set explicitly per call.
- JSON comes from structured outputs (`output_config.format`) built from the same Zod
  schemas in `lib/schemas.ts`. Zod validation plus one retry covers the rules JSON Schema
  can't express. Stripping stray fences stays as a guard.
- `stop_reason` of `refusal` or `max_tokens` is reported as its own failure. The API's
  server-side refusal fallback (`fallbacks: "default"`) is on.

### How the stages work (implemented in phase 3)

- A `generation_batches` row holds each batch's state between stage requests (drafts,
  verdicts, outcomes, per-call metrics). A request claims the batch before running a stage,
  so two requests never run the same batch at once.
- Validation is per question, not per batch. A draft that fails validation gets one retry
  (the `draft_retry` stage) with its problems listed; failing again drops that question
  only. A whole batch is dropped only when its draft call fails outright twice, or the
  critique fails twice.
- The critique is one call per batch. Any failed check, any filler distractor, or a stem
  that the word-overlap check finds too close to an existing one sends the question to
  revise.
- "Still fails after revise" means the revised question fails validation or the overlap
  check; there is no second critique (one round only). Dropped questions are replaced by
  top-up batches.
- Word-overlap check: 3-word shingles, overlap coefficient, threshold 0.6.
- `marks` and `topic_label` come from the slot, not the model.
- Chunks labelled "Course logistics" (title slides, admin) never get questions.

## Rate limits

- Every model call retries HTTP 429 with exponential backoff plus jitter, and waits for the
  `retry-after` header when the API sends one. The SDK's built-in retries are off
  (`maxRetries: 0`) so one wrapper owns retrying and can count it. Because that also
  removes the SDK's retries for overloaded (529) and 5xx responses, those use the same
  backoff.
- Backoff never sleeps past the request's 60 s budget. If the next wait would overrun it,
  the stage fails with a rate-limit error that includes the retry count, and the client
  can re-run that stage.
- Each call logs one JSON line: exam id, batch, stage, attempts, 429 retries, total time
  spent waiting, and duration. The generate response returns the same numbers, and the
  phase 3 debug UI totals them per run, so you can see when limits are what slowed a batch.
- Parallelism starts at 4 batches. If tier-1 limits regularly reject parallel drafts, it
  drops to 2. That's one client constant, `MAX_PARALLEL_BATCHES`.

## Timing

- Under 60 s wall clock for a 20-question mock is a goal, not a constraint. Phase 3
  measures real timings (per stage, per batch and wall clock) and reports them. 90 s is
  acceptable; the architecture doesn't bend to hit 60 s.
- The hard constraint is unchanged: each individual request finishes within
  `maxDuration = 60`.

## Regeneration

- New exam row, new seed, empty `used_chunk_ids`, `parent_exam_id` pointing at the
  previous exam. Chunks used anywhere in the parent chain are ranked last; stems from the
  whole chain are excluded.

## Sample exam

- Stored at `blueprints.storage_path`. It never enters the material chunk pool.
- Its questions are permanently on the exclusion list for every generated exam.

## Schema additions

Each lands in its own reviewed migration when the phase that needs it starts.

- `blueprints.storage_path`
- `exams.plan` (jsonb)
- `exams.parent_exam_id`
- `materials.error`
- The phase 0 `pings` table is dropped in phase 1.

## Math notation

- LaTeX delimiters are `\(...\)` inline and `\[...\]` display. `$` is always a literal
  currency sign.
- A repair step, with tests, fixes LaTeX that JSON escaping breaks. The material is
  econometrics, so test with `\beta`, `\frac`, `\hat` and friends:
  - Before parsing: a backslash followed by a character that is not a valid JSON escape
    (`\hat`, `\sigma`, `\(`, `\[`, and `\u` not followed by 4 hex digits, as in
    `\underline`) gets doubled.
  - After parsing: inside math delimiters, control characters produced by valid escapes
    that collide with LaTeX commands (`\b`eta, `\f`rac, `\t`heta/`\t`imes, `\n`u/`\n`eq,
    `\r`ho/`\r`ight) are restored to the command.

## Marking

- MCQ: deterministic and instant.
- Short and numerical answers are graded as soon as they're submitted, one call per
  answer, with a "marking…" state.

## Material ingestion

- Headings are preferred break points; consecutive pages merge up to about 2,500 tokens
  with about 300 tokens of overlap. A new heading starts a new chunk once the current one
  holds about 600 tokens (changed during phase 1: slides are sparse, and merging all the
  way to 2,500 left a whole deck as one or two chunks with a single topic label).
- Topic labelling runs in batches of about 20 chunks per call and is given the existing
  labels so it reuses them.
- Scanned PDFs (almost no text layer) fail with a clear message. No OCR in v1.
- `.pptx` is rejected in v1 with exact export steps (PowerPoint: File → Export → PDF;
  Keynote: File → Export To → PDF; Google Slides: File → Download → PDF Document).
  Revisit pptx support after phase 5 if there's time.
- TXT and MD files have a null `page_count`.

## Explanation validation

- "Bare restatement": reject an explanation if fewer than 8 words remain after removing
  the option's own words.
- Sentence counts (1–2 for wrong options, 2–4 for the correct one) are enforced by the
  prompt and the critique, not by Zod.

## Access

- One shared passphrase from the `APP_PASSPHRASE` env var, checked in middleware. No
  accounts. **Not built while MockBuddy runs locally; it lands before the first deploy.**

## Design (phase 6)

- Lighten `--chip-dim` and gold-on-`--felt` text to reach 4.5:1. `--chip-red` is only a
  fill, with cream text on it.
- shadcn/ui's `tw-animate-css` and Base UI stay; no MockBuddy animation uses them.
