# MOCKBUDDY — PROJECT SPEC

## 1. What this is

MockBuddy is a web app that turns a student's own course material into realistic practice
exams. The student uploads all their class slides in one place, then uploads one past exam
or mock that they know resembles the real thing. MockBuddy learns the style of that sample
exam and generates a brand new mock in the same style — but drawing on the whole body of
material, not only the topics the sample happened to cover.

The student picks how many questions (5, 10, 15 or 20) and a difficulty relative to the
sample (easier, same level, harder), pulls a slot machine lever, and watches the reels spin
while the exam is generated. They take it, and every question is marked immediately with a
precise explanation of why the correct answer is correct and why each wrong option is wrong.

A regenerate button at the bottom produces a completely fresh mock from the same material
and settings.

Theme: casino / slot machine. Deployed on Vercel from GitHub.

## 2. Stack (pinned — do not substitute)

- Next.js 15, App Router, TypeScript
- Tailwind CSS + shadcn/ui
- Supabase: Postgres (database) + Storage (uploaded files)
- Drizzle ORM + `postgres-js` driver (NOT Prisma — avoids the build-step generation issue on Vercel)
- Anthropic API, model `claude-sonnet-5-5`, called **only** from server-side route handlers
- Zod for validating every model response
- KaTeX for mathematical notation
- `unpdf` for PDF text extraction
- Animation in plain CSS transforms and `requestAnimationFrame`. No animation library.

## 3. Out of scope for v1

- Authentication, signup, accounts. Single hard-coded demo user (`DEMO_USER_ID`).
- Payments, pricing, anything resembling real gambling or wagering. The casino theme is
  purely visual.
- Embeddings, pgvector, vector search. Chunk selection is deterministic rotation.
- Image or diagram questions.
- Saved exam history browsing, leaderboards, streaks, social features.
- Email, notifications, cron jobs.

## 4. Hard constraints

1. **Serverless timeout.** Assume 60 seconds per request. `export const maxDuration = 60`
   on every AI route. Never generate a full exam in one request — generate in batches of
   **5 questions**, with the client looping and driving the reel animation from batch
   progress. A 20-question mock is therefore 4 batches.
2. **Request body limit.** ~4.5 MB. Files are never POSTed through an API route. The server
   issues a Supabase signed upload URL; the browser uploads straight to Storage; only the
   storage path reaches the backend.
3. **Secrets.** `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only, never
   `NEXT_PUBLIC_`, never referenced in a client component.
4. **JSON only.** Every model call returns a bare JSON object: no prose, no markdown fences.
   Strip stray fences defensively, parse, validate with Zod. On failure, retry once with the
   validation error appended; on second failure, drop that batch and continue.
5. **Cost ceiling.** Cap material at 200 chunks. Refuse further uploads with a clear message
   rather than silently truncating.

## 5. User flow — four screens

**Screen 1 — The Table (home)**
Two clearly separated drop zones on a casino-felt background:
- *Your material* — accepts many files (PDF, PPTX exported to PDF, TXT, MD). Each uploaded
  file appears as a casino chip with its name and page count. Shows total topics detected.
- *Your sample exam* — accepts exactly one file. Replacing it replaces the blueprint.

Below: two selector controls styled as casino elements.
- Question count: 5 / 10 / 15 / 20, as poker chips the user clicks.
- Difficulty: EASIER / SAME / HARDER, as a three-position lever or dial.

Then the primary action: a physical-looking slot machine lever labelled **PULL**.
It is disabled until both material and a sample exam are present.

**Screen 2 — The Spin (generation)**
Full-screen slot machine. Three reels spin with topic labels drawn from the user's own
material. As each batch of 5 questions completes, one reel slows and locks with a clunk,
showing the topics that batch drew from. Beneath: a status line in neon type —
"Reading the house rules…" → "Dealing from Topic 4…" → "Checking the deck…" →
"JACKPOT — 20 questions ready".
If `prefers-reduced-motion` is set, replace the reels with a plain progress bar and the same
status lines. Generation must never be blocked by the animation finishing.

**Screen 3 — The Hand (taking the exam)**
One question per screen, dealt as a playing card that flips in. Options are chips the user
clicks. Immediately on answering, the card flips to reveal the verdict:
- Correct: chips cascade, a short win sound cue (muted by default, with a toggle).
- Wrong: the chosen option dims to grey, the correct one lights gold.
Then the explanation block (section 9) renders underneath. A navigator strip at the top
shows all questions as cards: face-down (unanswered), gold (correct), grey (wrong).

**Screen 4 — The Payout (results)**
Score as a slot machine payout display. Per-topic accuracy table styled as a betting board,
weakest topic flagged "COLD", strongest "HOT". Every question reviewable with its full
explanation.

At the bottom, a prominent **REGENERATE** button: same material, same sample exam, same
count and difficulty, completely new questions. It must produce a genuinely different exam,
not a reshuffle — see section 7.

## 6. Data model

```
materials
  id, user_id, filename, storage_path, page_count,
  status ('uploaded'|'extracting'|'chunked'|'failed'), created_at

chunks
  id, material_id, ordinal, section_label, topic_label,
  content, token_estimate, created_at

blueprints
  id, user_id, source_filename, spec (jsonb),
  sample_questions (jsonb — verbatim questions lifted from the sample exam),
  created_at

exams
  id, blueprint_id, question_count, difficulty ('easier'|'same'|'harder'),
  status ('generating'|'ready'|'graded'),
  used_chunk_ids (jsonb array), generation_seed (int), created_at

questions
  id, exam_id, ordinal, type ('mcq'|'short'|'numerical'),
  prompt, marks, options (jsonb), correct_option,
  option_explanations (jsonb — one entry per option, see section 9),
  correct_explanation (text),
  expected_answer, rubric (jsonb), numeric_answer, tolerance, unit,
  worked_solution, source_chunk_id, source_excerpt, topic_label, difficulty

answers
  id, exam_id, question_id, response, is_correct, awarded_marks, feedback, answered_at
```

`source_chunk_id` and `source_excerpt` are mandatory on every question. They power the
"from Topic 4" label and are the defence against invented content.

## 7. The pipeline

### Stage A — Material ingestion
1. Signed-URL upload to Supabase Storage.
2. Extract text with `unpdf`.
3. Chunk by detected heading, otherwise by page, targeting ~2500 tokens with ~300 overlap.
   Store a readable `section_label`.
4. One cheap AI pass labels each chunk with a `topic_label`. These labels are what spin on
   the reels, so they must be short and human-readable ("Omitted variable bias", not
   "Chapter 4 part 2").

### Stage B — Blueprint extraction
One AI call over the sample exam text. Returns the Blueprint JSON (section 8) **and**
`sample_questions`: 3–5 complete questions copied verbatim from the sample, chosen to span
the question types present. These verbatim questions are the single most important input to
generation quality — they are included in every generation call as few-shot examples.

### Stage C — Generation (the quality system)

This runs per batch of 5 questions, and is three calls deep, not one. Do not collapse it.

**C1 — Draft.** Input: the blueprint, the verbatim `sample_questions`, the difficulty
setting with its concrete definition (section 10), the selected chunks for this batch, and
the stems of all questions already generated for this exam. Output: 5 draft questions.

**C2 — Critique.** A second call receives the drafts plus their source chunks and acts as a
strict examiner. For each question it checks:
- Is it answerable from the supplied material alone?
- Is there exactly one defensible correct answer?
- Is every distractor plausible to a student who has studied but holds a specific
  misconception? Flag any distractor that is obvious filler.
- Does it match the sample's phrasing conventions and stem length?
- Does it duplicate the point tested by an earlier question?
Output: a verdict per question — `pass`, or `revise` with specific instructions.

**C3 — Revise.** Any question marked `revise` goes back with the critique attached. One
round only. If it still fails, drop it and generate a replacement from a different chunk.

**Chunk selection.** Order chunks by `topic_label`, then round-robin across topics so
consecutive questions come from different parts of the material. Track `used_chunk_ids` on
the exam and prefer unused chunks. This is what delivers coverage beyond the sample's own
topics.

**Regeneration.** The REGENERATE button creates a new exam row with a new `generation_seed`
and an empty `used_chunk_ids`, and offsets the round-robin starting position by the seed, so
a different slice of material is drawn. Set temperature to 1.0 on the draft call. The new
exam must not reuse any question stem from the previous exam in the session — pass the
previous stems in as exclusions.

### Stage D — Marking
- **MCQ**: deterministic comparison, no AI call. Explanations were generated with the
  question, so feedback is instant.
- **Numerical**: parse the response to a number, compare within `tolerance`. Only if parsing
  fails, one AI call judges whether the response expresses the right quantity.
- **Short answer**: one AI call per batch of 5, supplying response, `expected_answer` and
  `rubric`. Grade **generously** — award rubric points that are clearly present even if the
  phrasing is loose. Never mark a substantively correct answer wrong over wording.

## 8. JSON schemas

Define in `lib/schemas.ts` as Zod schemas, derive TypeScript types from them, and include
the schema verbatim in each prompt.

### Blueprint
```json
{
  "duration_minutes": 90,
  "instructions_style": "how the sample phrases its rubric",
  "tone_notes": "phrasing conventions: person, verb forms, whether stems open with a scenario, typical stem length in words, how options are phrased",
  "sections": [
    {
      "name": "Section A",
      "question_type": "mcq",
      "proportion": 0.6,
      "marks_each": 2,
      "style_notes": "four options, full sentences, roughly a third ask what happens under a stated violation",
      "observed_difficulty": "medium"
    }
  ],
  "sample_questions": [
    { "type": "mcq", "verbatim_text": "the complete question exactly as it appears in the sample, options included" }
  ]
}
```
`proportion` rather than `count`, because the user chooses the total. A 10-question exam at
0.6 MCQ yields 6 MCQs. Round to whole numbers, assign any remainder to the largest section.

### Generated question
```json
{
  "type": "mcq | short | numerical",
  "prompt": "LaTeX permitted inside $...$",
  "marks": 2,
  "options": ["...", "...", "...", "..."],
  "correct_option": 0,
  "option_explanations": [
    { "index": 0, "is_correct": true,  "explanation": "why this is right, naming the principle it rests on" },
    { "index": 1, "is_correct": false, "explanation": "the specific misconception this option represents, and the fact that refutes it" }
  ],
  "correct_explanation": "2-4 sentences: the reasoning in full, referring to the material",
  "expected_answer": "string or null",
  "rubric": [{ "point": "string", "marks": 1 }],
  "numeric_answer": 2.45,
  "tolerance": 0.01,
  "unit": "string or null",
  "worked_solution": "full reasoning, shown after answering",
  "source_excerpt": "short verbatim phrase from the supplied chunk the question rests on",
  "topic_label": "string",
  "difficulty": "easy | medium | hard"
}
```
Fields irrelevant to the type are `null`. `option_explanations` is mandatory for MCQ and must
contain one entry per option, including the correct one.

## 9. Explanation requirements

This is a headline feature. Enforce it in the prompt and in validation.

Every wrong option's explanation must:
- Name the specific misconception or error that would lead a student to pick it. Not "this
  is incorrect" — rather "this confuses unbiasedness with efficiency".
- State the fact or principle that refutes it.
- Be 1–2 sentences. Precise, not padded.

The correct option's explanation must state the principle the answer rests on and connect it
to the material, in 2–4 sentences. Reject at validation any explanation shorter than 8 words
or containing a bare restatement of the option text.

## 10. Difficulty definitions

Never pass the adjective alone to the model. Pass these definitions:

- **EASIER** — single-step recall or direct application from one chunk. The correct answer
  follows from one stated definition or formula. Distractors are plausible but differ on an
  obvious dimension. Stems shorter than the sample's.
- **SAME** — match the observed difficulty of the sample exam as recorded in the blueprint.
  Comparable stem length, comparable number of reasoning steps.
- **HARDER** — requires combining two chunks, or applying a principle to a scenario not
  present in the material, or reasoning backwards from a result to a cause. Distractors
  represent errors a student who mostly understands the topic would still make. Never
  harder by being vaguer or by hinging on an obscure detail — harder by requiring more
  reasoning steps.

## 11. Design system — casino

Dark, rich and tactile. Not neon-casino-tacky, more "private table at a good hotel".

```
--felt-deep:   #0B3D2E   /* page background */
--felt:        #14563F   /* card surfaces */
--gold:        #D4AF37   /* primary accent, correct answers, lever */
--gold-bright: #F2D16B   /* hover, glow */
--chip-red:    #B5322F   /* wrong answers, the sample-exam drop zone */
--chip-cream:  #F4EFE4   /* primary text */
--chip-dim:    #9CAFA5   /* secondary text */
--wood:        #3A2317   /* frames, the slot machine cabinet */
```

Typography: a high-contrast display face for headings and the payout display, with a
condensed grotesque for body. Numbers in a tabular figure face so the payout counter does
not jitter as it counts up.

Texture: a subtle felt noise overlay on the background. Gold elements get a thin inner
highlight and a soft outer glow on hover. Cards have a real shadow and a 3D flip on reveal.

**Slot machine animation spec**
- Three vertical reels in a wooden cabinet, each a column of topic labels from the user's
  material, repeated and translated on the Y axis.
- Pulling the lever starts all three at high speed with motion blur (a CSS gradient mask,
  not a filter).
- Reels decelerate on an ease-out curve and lock left to right as generation batches land.
  Each lock gets a short shake of the cabinet and a click.
- On completion: the cabinet flashes gold, chips cascade from the top of the screen using
  simple transform animations on ~30 elements. No physics library.
- Everything above is decorative. The questions must be usable the moment data arrives, even
  if a user skips the animation.
- Respect `prefers-reduced-motion` throughout: static reels, progress bar, no cascade.

Accessibility is not optional: 4.5:1 contrast on all text, visible focus rings in gold, full
keyboard navigation of chips and options, and `aria-live` announcements of correct/wrong that
do not depend on colour alone.

## 12. Routes

```
app/page.tsx                      The Table — upload, count, difficulty, lever
app/spin/[examId]/page.tsx        The Spin — slot machine during generation
app/exam/[examId]/page.tsx        The Hand — taking the exam
app/exam/[examId]/results/page.tsx  The Payout — score, topics, regenerate

app/api/upload-url/route.ts       POST -> signed Supabase upload URL
app/api/materials/ingest/route.ts POST -> extract, chunk, topic-label
app/api/blueprint/route.ts        POST -> blueprint + verbatim sample questions
app/api/generate/route.ts         POST -> one batch of 5 (draft, critique, revise)
app/api/grade/route.ts            POST -> grade short/numerical answers
app/api/regenerate/route.ts       POST -> new exam, new seed, excluded stems
```

## 13. Build phases

Commit and push after each. Confirm the Vercel deploy is green before continuing.

- **Phase 0** — Scaffold, Supabase connection, Drizzle schema and migration, one page that
  writes and reads a row. Deploy. Nothing else.
- **Phase 1** — Uploads via signed URL, extraction, chunking, topic labelling. A debug page
  listing chunks with their labels, so chunking quality is visible before anything depends
  on it.
- **Phase 2** — Blueprint extraction including verbatim sample questions, displayed for
  review.
- **Phase 3** — Generation: draft, critique, revise, batched. Plain unstyled UI. Prove the
  questions are good before making anything pretty.
- **Phase 4** — Exam taking and marking with the full explanation blocks. Still plain.
- **Phase 5** — Results, topic breakdown, regenerate.
- **Phase 6** — The casino theme and the slot machine across all screens.

Phases 3 and 4 before 6, always. A beautiful app that generates bad questions is a failed
project; a plain one that generates good questions is a working product that needs a coat
of paint.

## 14. Acceptance criteria

On the deployed URL:
1. Several slide PDFs and one past exam can be uploaded and processed.
2. The blueprint visibly reflects the real structure of the uploaded exam, and the verbatim
   sample questions are the actual questions from it.
3. Choosing 20 questions produces 20, drawn from at least 6 distinct topic labels.
4. Side-by-side, a generated question is recognisably in the same style as the sample.
5. HARDER produces measurably longer multi-step questions than EASIER on the same material.
6. Every MCQ shows an explanation for every option, each naming a specific misconception.
7. REGENERATE produces an exam sharing no question stems with the previous one.
8. The slot machine runs during generation and degrades to a progress bar under
   `prefers-reduced-motion`.
9. No API key appears in any client bundle.

## 15. Environment variables

```
ANTHROPIC_API_KEY=
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DEMO_USER_ID=demo
```
Ship a `.env.example` with empty values. Never commit `.env.local`.
