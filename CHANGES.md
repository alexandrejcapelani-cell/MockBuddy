# CHANGES.md — MockBuddy v2

Everything below is one body of work. Build in the order given: section 1 is worth
60% of the project grade, section 2 is what makes it usable, section 3 is what makes
it good. Do not start section 3 until 1 and 2 are done and deployed.

Keep what already works: chunking, blueprint extraction, the draft/critique/revise
pipeline, option-by-option explanations, topic rotation, the results breakdown, the
history page, the casino theme. This is a restructure, not a rebuild.

---

# 1. Grading contract compliance (do first)

An automated bot grades this app on its public Vercel URL, acting like a stranger.
Read the brief in ASSIGNMENT.md (I will paste it into the repo) and follow it exactly.

## 1.1 CLAUDE.md
Create `CLAUDE.md` at the repo root containing the grading contract from the brief,
pasted verbatim. Never remove or weaken it.

## 1.2 Supabase, replacing the local database
- Migrate from the local Postgres/PGlite setup to a real Supabase project (EU region).
- Supabase Auth with email and password. Confirm email must be OFF.
- Supabase Storage for uploaded files, replacing local filesystem storage. The storage
  adapter interface already exists — swap the implementation.
- Row Level Security ON for every table, with policies keyed to `auth.uid()`.
  Nobody can read anything without logging in. No user can see another user's rows.
- Give me the SQL to paste into the Supabase SQL Editor, and tell me exactly where.
- Only the Supabase URL and publishable (anon) key may reach the browser. The secret
  key and the Gemini key never leave the server.

## 1.3 Routes
- `/` — public landing page, no login required. See section 2.1.
- `/signup` — email + password. Redirects to `/app` on success.
- `/login` — email + password. Redirects to `/app` on success.
- `/app` — the main feature, logged-in users only.
- Logout button visible on every page of a logged-in user.
- No email confirmation, no CAPTCHA, no Google-only login, no onboarding wall
  before `/app`.

## 1.4 data-testid attributes (exact names, do not translate)
- Sign-up form: `signup-email`, `signup-password`, `signup-submit`
- Login form: `login-email`, `login-password`, `login-submit`
- `logout` on the logout button
- On `/app`:
  - `core-input` — a TEXT field (type="text" or textarea) for the name of a new
    SUBJECT, e.g. "Econometrics"
  - `core-submit` — the button that saves it
  - `core-item` — every saved subject in the list

**Critical:** typing only in `core-input` and clicking `core-submit` must save a new
subject and render it as a `core-item`, with no file upload, no API call and no other
required field. This is the path the grading bot tests. It must never depend on the
Gemini API, on quota, or on anything that can fail.

Subjects are the container everything else lives in: material, blueprint, exams and
history all belong to a subject.

## 1.5 Remove bring-your-own-key
- Delete the API key field and all BYOK code paths.
- The Gemini key lives only in `GEMINI_API_KEY`, server-side, as a Vercel environment
  variable. Never in the browser bundle, never in the repo.
- Add a per-user quota: **2 free mock generations per account.** Count completed
  generations in the database against `auth.uid()`. When exhausted, show a clear,
  friendly message rather than an error, and keep everything else in the app working.
- Enforce the quota server-side. A client-side check alone is not enough.

## 1.6 Ship it
- Push to a **public** GitHub repository.
- Deploy to Vercel. Add every environment variable before the first deploy.
- Verify `.env.local` is in `.gitignore` and was never committed.
- In Supabase, set Site URL and Redirect URLs to the Vercel production domain.
- Give me the short production URL, not a deployment-specific one.

---

# 2. Fixes and restructure

## 2.1 Landing page at `/`
A first-time visitor who never logs in must understand, within five seconds, what this
is, who it is for and what to click. One headline naming the user and the result, one
short subheadline, one obvious Sign up button. Keep the casino styling but do not let
it obscure the message. Must work on a phone with no sideways scrolling.

## 2.2 The slot machine floor — `/app`

This is the centrepiece. `/app` should look like an actual slot machine cabinet, not a
form with a theme on top.

**Top strip — pick a table.** The subject selector. `core-input` for a new subject name,
`core-submit` to add it, each subject rendered as a `core-item` chip. Selecting a subject
loads the three lanes beneath. This strip is always visible and never blocked.

**Three vertical lanes inside one wooden cabinet**, for the selected subject:

- **Left lane — your material.** Drop zone for many files. Uploaded files stack as
  casino chips with name and page count. Shows the topic count once chunking is done.
- **Middle lane — the reference exam.** Drop zone for exactly one past exam or mock.
  Shows the extracted blueprint in summary: question types, counts, duration.
- **Right lane — the generated exam.** Empty until a mock exists. Once generated, it
  shows the exam as a card the user can click to open full screen (see 2.3).

**Controls beneath the cabinet, styled as real casino hardware:**
- Four poker chips for question count: 5, 10, 15, 20. One selected at a time.
- Three positions for difficulty: EASIER, SAME, HARDER.
- A physical-looking lever on the right side of the cabinet. Pulling it generates a new
  mock. The same lever regenerates once an exam already exists.
- Beneath the lever, in neon type: how many free generations the user has left,
  e.g. "2 spins remaining".

All controls must be real radio inputs underneath for keyboard and screen-reader access,
however they look.

## 2.3 Full-screen exam view
Clicking the right lane opens the exam full screen. Readability wins over theme here:
generous line length, high contrast, large question text. Keep the casino framing —
felt background, gold accents, cards that flip on answer, chips for options — but never
at the cost of being able to read a question.

A clear, always-visible button returns to the slot machine floor without losing state.

## 2.4 Gemini 503 overloaded errors
Currently generation fails with "The Gemini model is overloaded (HTTP 503)". Fix:
- Retry 503 and 429 with exponential backoff and jitter, up to 5 attempts.
- On persistent 503, fall back to a different Gemini model automatically and say so
  in the status line.
- Never surface a raw HTTP code to the user. Say what happened and what to do.
- A failed batch must not lose the batches that succeeded. The run resumes.

## 2.5 Blueprint extraction hangs
Uploading a sample exam can sit on "Reading the exam and extracting its blueprint" for
ten or more minutes with no error. Fix:
- Hard timeout on the call. If it expires, show an error and a Retry button.
- Surface the real failure: no text layer in the PDF, quota exhausted, model overloaded,
  parse failure. Each gets its own message.
- Log the stage transitions so a hang is visible in the server log.
- Never leave a spinner running with no path forward.

## 2.6 Generation is too slow
A mock currently takes around two minutes. Do not guess at the cause: read the per-call
timings already being logged and report the breakdown — time per stage, per batch, API
wait versus our own code. Then fix in order of impact. Consider, but let the data decide:
- Re-test parallel batches against the real free tier rather than assuming rate limits.
- Use the fastest Gemini model for the critique pass; it is a judgement, not composition.
- Skip the critique pass entirely for 5-question mocks.
- **Stream questions to the exam view as each batch lands**, so the user can start
  answering while the rest generate. Do this regardless of what the timings say.

Report before and after numbers.

## 2.7 File types
Material uploads currently accept PDF only. Add `.pptx`, `.docx`, `.txt` and `.md`,
extracting text properly from each, including slide and heading titles so topic labelling
still works. The reference exam zone accepts the same. Update the drop zone copy to list
what is actually accepted. Keep a clear, specific error for scanned PDFs with no text layer.

---

# 3. Polish

## 3.1 Slot machine animation on every wait over ~3 seconds
The reels currently run only during question generation. Reuse the same component for:
- Reading and chunking uploaded material ("Counting the deck…")
- Blueprint extraction ("Reading the house rules…")
- Generation and regeneration, as now

Same cabinet, same reels, different status line. Under `prefers-reduced-motion`, a
progress bar with the same status lines.

## 3.2 Keep accessibility real
4.5:1 contrast on all text, visible gold focus rings, full keyboard navigation of chips,
lever and options, `aria-live` on verdicts, no sideways scrolling at 375px wide. The
existing contrast test must keep passing.

---

# Rules

- Commit after each numbered section. Deploy and verify after section 1.
- Do not weaken the grading contract to make anything else easier.
- Flag anything you cannot verify rather than assuming it works.
- Tell me each manual step I need to do in Supabase, GitHub and Vercel, in order.
