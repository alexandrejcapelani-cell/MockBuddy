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

## Models per call (2026-10-19)

- One map in `lib/ai/config.ts` (`MODELS`) picks the model for each kind of call; it is the
  only place to change model choice. This replaces the spec's single pinned model.

  | Call | Model |
  | --- | --- |
  | Topic labelling | `claude-haiku-5-5` |
  | Blueprint extraction | `claude-opus-5-5` |
  | Draft, critique, revise, grading | `claude-sonnet-5-5` |

- Callers name the task, not the model; effort and output caps come from the same file.
- Every call's log line and stored metrics record the model requested, the model that
  answered (they differ only if a refusal fallback ran), tokens, timings and an estimated
  cost from list prices in `lib/ai/pricing.ts`. The review page splits a run's cost by
  stage and by model; each upload shows its labelling or blueprint call's model, time and
  cost when it finishes.
- None of the three models accepts non-default sampling parameters, so no call sends
  `temperature`. Haiku 5.5 has no server-side refusal fallback; with `fallbacks: "default"`
  a declined Haiku request simply stays declined and is reported as a refusal.

## Bring your own key (BYOK)

- **BYOK is the intended model for anyone else using MockBuddy, so the deployed app never
  spends the owner's credits.** On the deployment `ANTHROPIC_API_KEY` stays unset: a request
  without a pasted key then fails with "missing key" instead of falling back to the owner's.
- The home page has a key field. The key is stored only in that browser's `localStorage`,
  shown masked (`sk-ant-…` plus the last 4 characters) with a Clear button.
- The browser sends it in the `x-anthropic-key` header, and only on requests that call the
  model (material ingest, blueprint, generate, and grading in phase 4). Never in a URL or
  query string.
- The server uses it for that request's Anthropic client only: a fresh client per call,
  never cached. It is never stored, written to the database or logged; failure messages
  name which key was used, never its value.
- Without the header the server falls back to `ANTHROPIC_API_KEY` from `.env.local`, so
  local runs keep using the owner's account without pasting anything.
- Distinct failures, each with its own message and status: missing key (401), invalid key
  (401 from Anthropic, or 400 for a malformed paste), out of credits or spend limit reached
  (402), rate limited (429, after the automatic backoff retries).
- A key problem doesn't fail a generation batch: the batch stays at its stage, so after
  fixing the key, "Resume generation" carries on where it stopped.
- Known limits: `localStorage` is readable by any script running on the app's origin, so
  the page must never load third-party scripts; and users must trust the deployment,
  since their key passes through its server.

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
- No `temperature` parameter: the models reject non-default values, and 1.0 is the
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

### How marking works (implemented in phase 4)

- One route, `POST /api/grade`, marks every answer type. MCQ and numbers the parser can
  read never call the model; short answers, and numbers it can't read, make one call
  (Sonnet 5.5, the `grading` task), plus one retry if the marking comes back malformed.
- Numbers: a decimal comma is accepted ("2,4"). "1,234" is ambiguous (1234 or 1.234), so
  both readings are tried and either can be right. Anything with no number or several
  numbers ("b1 = 2.4", "two point four") goes to the model to judge.
- Short answers: marks per rubric point, generous by instruction. A short answer counts
  as correct (gold in the navigator) at half marks or more; anything between 0 and full
  marks is labelled "Partly right" or "Mostly right" with the marks in words.
- `answers.rubric_marks` (jsonb) stores the marks and reason per rubric point, so the
  verdict can show them. It is an addition to the spec's data model.
- Answering is final: a second submission returns the stored answer unchanged.
- The answer key and every explanation stay on the server until a question is answered:
  the exam page's data for an unanswered question has the prompt and options only.
- Verdicts are given in words ("✓ Correct: 2 of 2 marks", "✗ Wrong: 0 of 2 marks. The
  correct answer is B.") in an `aria-live` region and in the navigator buttons' names, so
  they never depend on colour.
- The win sound, chip cascade and card flip belong to the casino theme (phase 6).

## Results and regeneration (phase 5)

- The score is marks earned over all marks in the exam; unanswered questions count as zero.
- Per-topic accuracy is marks earned over marks available on the questions answered in
  that topic. HOT and COLD flag the highest and lowest accuracy, only when at least two
  topics have different accuracies; ties share the flag.
- On the results page an unanswered question keeps its answer hidden, with a link back to
  answer it.
- REGENERATE (`POST /api/regenerate`) creates a new exam from the original exam's
  blueprint (the same sample exam, even if a newer one has been uploaded since), the
  material as it is now, the same count and difficulty, and a new seed. It links to the
  previous exam through `parent_exam_id`, so generation excludes every question stem in
  the chain (up to 5 exams back) and ranks the chain's used chunks last; the new exam's
  own `used_chunk_ids` starts empty. Generation then runs on the generation page like any
  other mock.

## History (phase 6)

- `/history` lists every mock for the user, newest first: date, question count (and how
  many survived generation), difficulty, score once at least one question is answered,
  and the weakest (COLD) topic. Each row opens the results page (or the spin page while
  still generating). This replaces the spec's "no saved exam history" in v1.
- With two or more taken mocks, a single-series line chart shows score over time: gold
  line and ringed markers on a hairline grid, the latest value labelled directly, a
  crosshair tooltip on hover and with the arrow keys, announced to screen readers. The
  table is the chart's table view.

## Landing page and waitlist (phase 6)

- `/` is the landing page: the pitch, a three-step "how it works", Start (to `/app`) and an
  email-only waitlist. The app itself is at `/app`.
- The `waitlist` table holds an email address and a timestamp, nothing else; one row per
  address (normalized to lower case). The route replies the same way whether or not the
  address was already listed, so it can't reveal who has signed up, and never logs
  addresses. No accounts.
- Before the landing page is public: add a privacy notice naming who holds the addresses
  and how to have one deleted (GDPR), rate-limit the waitlist route, and have the
  marketing copy reviewed.

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

- Contrast fixes to the spec's palette, all checked by `lib/theme.test.ts` against the
  values in `app/globals.css`: `--chip-dim` is #BACAC1 (was #9CAFA5, 3.7:1 on felt); gold
  text uses `--gold-text` #E6C65A (the spec's `--gold` stays for fills, borders and the
  lever); `--chip-red` is only a fill under cream text or text on cream card faces; card
  faces have their own ink colours; error text is #FFB4A8.
- Type: Playfair Display for headings and the payout display, Barlow Semi Condensed for
  body, tabular figures wherever numbers change.
- Everything animated is decorative and nothing waits for it: the exam link appears the
  moment generation finishes, and card animations move a card without ever hiding it.
- prefers-reduced-motion: the slot machine becomes static reels plus a progress bar,
  chips and count-ups are skipped, and CSS animations are switched off globally.
- Sound (win chime, reel click) is synthesised with Web Audio, off by default, and the
  choice is remembered in localStorage.
- Every selector is a native radio group under its styling (count chips, difficulty
  lever), so arrow keys work; focus rings are gold-bright (at least 3:1 on every surface).
- The table moved from `/` to `/app`; app screens share a header through the `(app)`
  route group.
- shadcn/ui's `tw-animate-css` and Base UI stay; no MockBuddy animation uses them.
