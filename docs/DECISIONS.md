# Decisions

Agreed on 2026-10-18 after the spec review, updated since. Where this file and
[MOCKBUDDY_SPEC.md](../MOCKBUDDY_SPEC.md) disagree, this file wins.

## Accounts, subjects and Supabase (CHANGES.md section 1, 2026-10-19)

This replaces local-first development: MockBuddy is graded on its public Vercel URL by a
bot that follows the grading contract in CLAUDE.md (copied verbatim from ASSIGNMENT.md;
never weaken it). Where this section and older ones disagree, this one wins.

- **Supabase** holds everything: Auth (email and password), Postgres, and Storage for
  uploads. Local development points at the same Supabase project through `.env.local`;
  the embedded PGlite database and the local file storage are gone. The schema is reset to
  one migration (`drizzle/0000_supabase_schema.sql`); `supabase/setup.sql` (tables, RLS,
  policies, the Storage bucket and its policies) is what gets pasted into the SQL Editor,
  regenerated with `npm run db:generate && npm run db:setup-sql`.
- **Environment.** Browser-visible, by design: `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Server-only: `DATABASE_URL` (the Transaction
  pooler string, which contains the database password) and `GEMINI_API_KEY`; optional
  `GEMINI_TIER`. **The Supabase secret / service_role key is not used anywhere.**
- **Routes.** `/` is public with one Sign up button. `/signup` and `/login` (email and
  password, through `supabase.auth.signUp` / `signInWithPassword` in Server Actions) send
  the user to `/app`. Everything else is behind a login: `middleware.ts` refreshes the
  session on every request and redirects pages to `/login` / answers API routes with 401;
  each page and route then checks the user again (`lib/auth.ts`, with `getClaims()`, never
  `getSession()`). The logout button (`data-testid="logout"`) is in every header and on
  the 404 page. `/signup` and `/login` stay usable while signed in (signing up replaces the
  session), because the bot may sign up its second user in the same browser.
- **The core item is a subject** (`core-input` → `core-submit` → a `core-item` chip on
  `/app`). Saving one is a single database write in a Server Action: no upload, no AI call,
  no other field. Names are trimmed, 1 to 80 characters, unique per user ignoring case
  (adding an existing name opens it). Material, the sample exam, mocks and history all
  belong to a subject; `/app?subject=<id>` shows one, defaulting to the newest.
- **Privacy, two layers.** (1) RLS is on for all 8 tables, each with one policy: signed-in
  users may SELECT their own rows (`user_id = auth.uid()`, or through the parent row).
  Signed-out (anon) users read nothing; nobody can insert, update or delete through
  Supabase's Data API, so the quota can't be bypassed there. Storage: one private bucket,
  `uploads`, where users can add, read and delete only under `<their user id>/`.
  `supabase/test/rls.test.ts` runs setup.sql on PGlite with Supabase emulated and checks
  all of this. (2) The server connects as the table owner (RLS doesn't apply to it), so it
  scopes every query to the signed-in user itself: `lib/ownership.ts` checks subjects and
  exams by id, and someone else's id answers exactly like a missing one (404). Storage
  calls use the signed-in user's session, so the Storage policies do apply to the server.
  A stricter version (running server queries as the `authenticated` role with the user's
  claims, so RLS covers them too) is possible later; it means wrapping every query.
- **BYOK is removed.** The pasted-key field, `localStorage` key, header and all per-request
  key plumbing are gone (the grading contract forbids AI keys in the frontend). The server
  uses `GEMINI_API_KEY` only; errors are worded for students (a key problem is "on our
  side"), with HTTP codes kept to the server log.
- **Free-mock quota: 2 per account**, counting new and regenerated mocks
  (`lib/generation/quota.ts`, `lib/free-mocks.ts`). Enforced on the server when a mock is
  created, inside a transaction holding a per-user advisory lock, so parallel requests
  can't both take the last one. A mock counts while it is generating and once it finished
  with at least one question; one that ended with no questions doesn't use a free mock.
  With none left, `/app` and the results page show a friendly note instead of the lever
  and the Regenerate button; everything else keeps working. (CHANGES.md says "count
  completed generations"; counting ones in progress too is what stops parallel starts
  from getting past the limit.)
- **Vercel limits.** Hobby with Fluid compute (on by default) allows 300 s per function,
  so the AI routes export `maxDuration = 300` and stop themselves 10 s before it. The old
  60 s worry is gone, though sequential batches still make a whole mock take minutes.
- **The waitlist is removed** (table, route and form): with real sign-up it duplicated the
  one Sign up button and held email addresses for no remaining purpose.
- **Gemini terms, now directly relevant:** the deployed app calls Gemini with the owner's
  key on behalf of other students. Google's terms allow only paid services for apps made
  available to users in the EEA, Switzerland or the UK, so a free-tier key doesn't meet
  them for classmates in Spain; and anyone can create accounts (no email confirmation), so
  a paid key needs a budget cap in Google Cloud. See "Gemini terms" below.
- **Verified** with a local stand-in for Supabase (PGlite with setup.sql applied, plus a
  fake of Auth and Storage) and the fake Gemini server, following the bot's script: sign
  up → `/app` → save a subject → it shows as a `core-item` → log out → wrong password
  refused → right password → item still there → a second user (in the same browser) sees
  nothing, and gets 404 from every page and API route for the first user's exam or subject
  ids → signed out, every page redirects to `/login` and every API route answers 401. Also
  uploads through signed Storage URLs, labelling, a blueprint, a full mock, the quota
  (2nd mock allowed, 3rd and Regenerate refused with the note), and 375 px with no
  sideways scrolling. **Not verified until the real project exists:** real Supabase Auth
  and Storage behaviour, the publishable key against the Data API, Vercel.

## AI provider: Google Gemini (2026-10-19)

- **MockBuddy now calls the Gemini API (Google AI Studio) instead of the Anthropic API, so
  it can run on a free-tier key.** This replaces the spec's pinned Anthropic API. The SDK is
  Google's `@google/genai`; `@anthropic-ai/sdk` is gone.
- Calls use Gemini's Interactions API (`interactions.create`), which Google lists as
  generally available and recommends for new projects (`generateContent` is now its legacy
  API). Every call sends `store: false`, so Google keeps no retrievable copy of the
  conversation (otherwise it keeps interactions for a day on the free tier, 55 days on
  paid). MockBuddy never needs server-side conversation state: each call is one user turn.
- Structured output: `response_format` with `mime_type: "application/json"` and a JSON
  Schema. `lib/ai/json-schema.ts` turns each Zod schema into the subset Gemini documents
  (types, nullable as `[type, "null"]`, properties, required, additionalProperties, enum,
  format, minimum/maximum, items, min/maxItems) and throws on anything else, such as unions,
  `pattern` or `minLength`. A test runs every output schema through it. Zod validation of
  each reply and the one retry with the problems listed are unchanged, and the LaTeX
  escape repair still runs before parsing.
- Thinking: Gemini's `thinking_level` replaces Anthropic's effort, set per task in
  `lib/ai/config.ts` (`THINKING`). Thinking counts toward `max_output_tokens`. An
  `incomplete` interaction is reported as cut off (max tokens); a `failed` one whose reason
  is a safety block is reported as a refusal. There is no server-side refusal fallback on
  Gemini, so that beta is gone.
- Dropped with Anthropic: `cache_control`. Gemini caches repeated prompt prefixes
  implicitly, and draft and revise still share one system prompt per exam, so the cache can
  reuse it. `temperature` is still never sent.
- Unchanged: the draft → critique → revise pipeline (three separate calls), chunk rotation,
  option-by-option explanations and their validation, marking rules, the casino theme.
- Verified only against a local fake of the Interactions API that mirrors the request and
  response shapes from the SDK's types and docs. Not yet checked against the real API:
  question quality from Flash compared with the Anthropic models, real free-tier limits, the
  real shape of a safety block, and whether `total_output_tokens` includes thinking tokens
  (the cost estimate assumes it doesn't).

### Gemini terms to know before sharing MockBuddy

- Google's Gemini API terms allow only paid services for apps made available to users in
  the EEA, Switzerland or the UK. Running MockBuddy yourself on a free key is fine; a
  deployment that other students in Spain or elsewhere in the EEA use needs paid keys.
  Revisit this before deploying.
- Outside the EEA, Switzerland and the UK, Google may use free-tier prompts and responses
  to improve its products, and human reviewers may read them; Google asks users not to
  send sensitive, confidential or personal information to its unpaid services. In the EEA,
  Switzerland and the UK the paid-service data terms apply to free usage too. Course slides
  and past papers may be confidential to the course: check before uploading them.
- The Gemini API terms require users to be 18 or older.

## Models per call (2026-10-19, Gemini since the same day)

- One map in `lib/ai/config.ts` (`MODELS`) picks the model for each kind of call; it is the
  only place to change model choice. This replaces the spec's single pinned model.

  | Call | Model | Thinking |
  | --- | --- | --- |
  | Topic labelling | `gemini-3.5-flash-lite` | low |
  | Blueprint extraction | `gemini-3.8-flash` | high |
  | Draft, critique, revise, grading | `gemini-3.8-flash` | medium |

- Why these: both are stable and on the free tier. Gemini's strongest models (Gemini 4
  Argon, 3.1 Pro) have no free tier, so `gemini-3.8-flash`, the newest stable Flash, is the
  main model. `gemini-3.5-flash-lite` is the Flash-Lite Google recommends for new projects;
  `gemini-3.1-flash-lite` is a little cheaper on a paid key if labelling cost ever matters.
  The blueprint gets high thinking because it runs once per sample exam and moved from
  Opus to a Flash model. `gemini-3.8-flash` rejects the `minimal` thinking level.
- Callers name the task, not the model; thinking levels and output caps come from the same
  file.
- Every call's log line and stored metrics record the model requested, the model the API
  reports, tokens (uncached input, cached input, output, thinking), timings, the billing
  tier and the estimated cost. The review page splits a run's cost by stage and by model;
  each upload shows its labelling or blueprint call's model, time and cost when it finishes.

### Cost

- **Free-tier calls cost exactly $0 and the UI says "free tier"**, never a would-be dollar
  figure. The API doesn't say which plan a key is on, so `GEMINI_TIER` in `.env.local`
  (`free` by default, or `paid`) says so for every call. Set it to `paid` on Vercel if the
  deployed key has billing on.
- On `paid`, costs come from Standard-tier list prices in `lib/ai/pricing.ts`, per million
  tokens: `gemini-3.8-flash` $0.75 in, $3.75 out, $0.075 cached input until 31 December
  2026, then double from 1 January 2027 (the file has both dated cards);
  `gemini-3.5-flash-lite` $0.30 in, $2.50 out, $0.03 cached. Thinking is billed at the
  output rate.

## Generation pipeline

- Draft, critique and revise stay three separate model calls. Each runs in its own HTTP
  request (`/api/generate` with a `stage`), with the state between stages saved in the
  database. Every AI route exports `maxDuration = 300`.
- Batches of 5 run **one at a time** from the client by default, for free-tier rate limits
  (see Rate limits). `exams.plan` assigns every slot its type, section, marks and chunk(s)
  up front, so batches don't depend on each other and can run in parallel again with one
  flag. For the wall-clock target, see Timing.
- Consequence, accepted: the draft call doesn't see stems from other batches of the same
  exam. Cross-batch dedup relies on chunk rotation, a server-side word-overlap check and
  the critique pass. Stems from the previous exam chain and the sample exam are still
  passed in as exclusions.
- Dropped questions (failed validation twice, or still failing after revise) are replaced
  by at most 2 extra batches, each through the full pipeline and drawn from unused chunks.
  If the exam is still short, it ships short and the UI says so.
- No `temperature` parameter: variety comes from the seed offset, the exclusions and chunk
  choice. The thinking level is set explicitly per call.
- JSON comes from Gemini's structured output, built from the same Zod schemas in
  `lib/schemas.ts` (see "AI provider"). Zod validation plus one retry covers the rules JSON
  Schema can't express. Stripping stray fences stays as a guard.
- A cut-off reply (`incomplete`) and a safety block are each reported as their own failure.

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

- Gemini's limits apply per Google Cloud project, not per key, and per model: requests per
  minute, input tokens per minute and requests per day (daily limits reset at midnight
  Pacific time). Google no longer lists the free-tier numbers on its rate-limits page;
  AI Studio shows each project's actual limits.
- **Batches run one at a time by default** (`BATCH_MODE = "sequential"` in
  `lib/ai/config.ts`), so a free-tier key isn't hit with several drafts at once. Set it to
  `"parallel"` to go back to up to `PARALLEL_BATCHES` (4) at once on a paid key. The stages
  inside a batch were always sequential.
- Every model call retries a per-minute 429 with exponential backoff plus jitter, and waits
  as long as Gemini's `RetryInfo.retryDelay` (or a `retry-after` header) asks, up to 60 s.
  A per-day 429 isn't retried: it's "quota exceeded". The SDK's built-in retries are off
  (`retries: { strategy: "none" }`; otherwise it retries 429 and 5xx up to 5 times on its
  own) so one wrapper owns retrying and can count it. Overloaded (503) and other 5xx
  responses use the same backoff.
- On the free tier the daily request limit is likely to bind before the per-minute one.
  A 20-question mock makes about 12 to 20 calls to the main model (4 batches × draft,
  critique, revise, plus draft retries and top-ups), plus one blueprint per sample exam
  and one call per short or unreadable numerical answer. Topic labels use the lite model,
  which has its own quota.
- Backoff never sleeps past the request's budget (290 s on Vercel). If the next wait would overrun it,
  the stage fails with a rate-limit error that includes the retry count, and the client
  can re-run that stage.
- Each call logs one JSON line: exam id, batch, stage, attempts, 429 retries, total time
  spent waiting, and duration. The generate response returns the same numbers, and the
  phase 3 debug UI totals them per run, so you can see when limits are what slowed a batch.

## Timing

- Under 60 s wall clock for a 20-question mock is a goal, not a constraint. Phase 3
  measures real timings (per stage, per batch and wall clock) and reports them. 90 s is
  acceptable; the architecture doesn't bend to hit 60 s.
- The hard constraint: each individual request finishes within its `maxDuration` (300 s
  on Vercel Hobby with Fluid compute; see "Accounts, subjects and Supabase").
- Running batches one at a time (the free-tier default) makes a mock's wall clock roughly
  the sum of its batches, so expect minutes rather than about one for 20 questions. That's
  accepted. Each request is still one model call, so the per-request limit is unaffected.

## Generation run ceiling (2026-10-19)

- **No generation run may exceed 3 minutes** (`GENERATION_RUN_LIMIT_MS` in
  `lib/ai/config.ts`). A run starts when the mock is created or when the student presses
  Retry (`exams.run_started_at`, migration `0001`; rows without it count from `created_at`).
- Why: a 10-question mock on the real free tier sat in "generating" for 20+ minutes. Batch 1's
  critique took 512 s (3 attempts) and its revise was rate limited (429) on 6 attempts over
  300 s; the browser then re-ran the stage. Nothing bounded the total, and locally there
  was no per-request deadline at all.
- Enforced in three places: every stage call gets the run's end as its deadline (locally
  too), so retries and backoff can't wait past it; the server refuses stages and top-ups
  after it (409, `kind: "run_timed_out"`; not 408, which browsers silently re-send); and the
  browser runner stops at the same moment, using the server's "time left" so the clocks
  needn't agree, with a timeout on every request.
- On timeout the spin screen says so (with the last problem, e.g. rate limited) and offers
  **Retry** (`/api/exams/[id]/retry`: a fresh 3 minutes, carrying on from each batch's
  stage, no extra free mock) and **Take the N ready questions** (`/api/exams/[id]/stop`:
  unfinished batches are marked failed and the mock is finalized short). Finished batches'
  questions are always kept. A late stage result can't revive a stopped batch.
- Reopening the page after the limit shows the timeout screen; it never restarts silently.
- Consequence to watch: on the real free tier a single draft call took about 115 s (8 to 13k
  thinking tokens), so a 10-question mock often won't fit in 3 minutes and will need a
  Retry. Making calls faster (CHANGES.md 2.6) is what makes the ceiling rarely bite.
- 429 log lines now include which Google quota was hit (`quotaIds`) and the requested wait.

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
  (`gemini-3.8-flash`, the `grading` task), plus one retry if the marking comes back malformed.
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

## Landing page (phase 6, updated in section 1)

- `/` is the landing page: the pitch (now naming who it is for, university students
  revising for an exam), a three-step "how it works", and one button, Sign up, which
  becomes "Open the app" for a signed-in visitor. The app itself is at `/app`.
- The waitlist is gone (see "Accounts, subjects and Supabase").
- Before it is promoted: have the marketing copy reviewed, and add a privacy notice for
  accounts (who holds the email addresses and uploaded material, why, and how to have them
  deleted), since real classmates will sign up.

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

- Supabase Auth accounts (email and password) replace the planned shared `APP_PASSPHRASE`.

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
