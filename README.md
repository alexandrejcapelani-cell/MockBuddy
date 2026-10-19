# MockBuddy

Practice exams dealt from your own slides, for university students revising for an exam.
Add a subject, upload your course material and one past exam, and MockBuddy writes a
brand-new mock in the same style, marks it as you answer and explains every option.

The product spec is [MOCKBUDDY_SPEC.md](MOCKBUDDY_SPEC.md); decisions that change or refine
it are in [docs/DECISIONS.md](docs/DECISIONS.md). The grading contract the app must keep is
in [CLAUDE.md](CLAUDE.md).

Stack: Next.js 15 (App Router) · Tailwind + shadcn/ui · Supabase (Auth, Postgres, Storage)
· Drizzle ORM + postgres-js · Gemini API via `@google/genai` (`gemini-3.5-flash-lite` for
topic labels, `gemini-3.8-flash` for everything else; see `MODELS` in `lib/ai/config.ts`)
· Zod · KaTeX · unpdf.

## How it works

- `/` is public. `/signup` and `/login` take an email and a password (Supabase Auth, no
  confirmation email) and lead to `/app`. Everything else needs a login.
- On `/app`, add a subject (the main feature: one text field and a button). Its material,
  sample exam, mocks and history belong to it.
- Every account gets 2 free mocks (new or regenerated), enforced on the server.
- Each user sees only their own data: row level security on every table and on Storage,
  and the server checks ownership on every request.

## Run it locally

Requires Node 24 and a Supabase project (local development uses the same project).

1. In Supabase: Authentication → Sign In / Providers → Email, turn **Confirm email** off.
2. Supabase → SQL Editor → New query: paste all of [supabase/setup.sql](supabase/setup.sql)
   and click Run, once.
3. Copy `.env.example` to `.env.local` and fill it in (it says where each value comes from).

```bash
npm install
npm run dev
```

Open http://localhost:3000. Costs show as "free tier" unless you set `GEMINI_TIER=paid`.
Batches run in parallel (for a key with billing); on a free-tier key, set `BATCH_MODE` in
`lib/ai/config.ts` to `"sequential"`. Don't run `npm run build` while `npm run dev` is
running: they share `.next`.

1. **Subject**: add one, e.g. "Econometrics".
2. **Your material**: slide PDFs, TXT or Markdown. Each is split into chunks and labelled
   by topic. `/debug/chunks` shows every chunk and its label.
3. **Your sample exam**: one past exam or mock. `/blueprint` shows what was learned from it.
4. **Generate a mock**: 5–20 questions and a difficulty. Uses one free mock.
5. **Take it**: one question at a time, marked as you answer, with an explanation for every
   option.
6. **Results**: score, accuracy by topic (HOT and COLD), and REGENERATE.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (against the Supabase project in `.env.local`) |
| `npm run build` | Production build |
| `npm run lint` / `npm run typecheck` / `npm test` | ESLint / TypeScript / tests (including the RLS test) |
| `npm run db:generate` | Generate a SQL migration from `lib/db/schema.ts` into `drizzle/` |
| `npm run db:setup-sql` | Rebuild `supabase/setup.sql` from the migrations and `supabase/storage.sql` |
| `npm run db:studio` | Browse the database with Drizzle Studio |

## Where things live

- `middleware.ts`, `lib/auth.ts`, `lib/supabase/`: sessions, the login gate, Supabase clients.
- `lib/ownership.ts`: the per-user checks on subjects and exams.
- `lib/db/schema.ts`: tables and RLS policies; `supabase/`: the setup SQL and its RLS test.
- `lib/ai/`: the model-call wrapper (structured JSON output, backoff, error messages), the
  per-task model map and settings (`config.ts`), and cost estimates (`pricing.ts`).
- `lib/ingest/`, `lib/blueprint/`, `lib/generation/`: stages A, B and C of the pipeline;
  `lib/generation/quota.ts`: the free-mock quota.
- `lib/storage/`: file storage (Supabase Storage, as the signed-in user).
