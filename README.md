# MockBuddy

Turns your own course material into realistic practice exams, in the style of one
sample exam. The product spec is [MOCKBUDDY_SPEC.md](MOCKBUDDY_SPEC.md); decisions that
change or refine it are in [docs/DECISIONS.md](docs/DECISIONS.md).

Stack: Next.js 15 (App Router) · Tailwind + shadcn/ui · Postgres (embedded PGlite locally,
Supabase later) · Drizzle ORM + postgres-js · Anthropic API (Haiku 5.5 for topic labels,
Opus 5.5 for the blueprint, Sonnet 5.5 for generation; see `MODELS` in `lib/ai/config.ts`) ·
Zod · KaTeX · unpdf.

## Status

Phases 0–5 are built: uploads, extraction, chunking and topic labels; blueprint extraction
with verbatim sample questions; generation (draft → critique → revise per batch of 5,
batches in parallel, top-ups for dropped questions); taking the exam with immediate
marking and explanations; and results with a per-topic breakdown and REGENERATE. The UI is
deliberately plain until phase 6 brings the casino theme.

To try the exam and results pages without calling the model, run `npm run db:seed-demo`
while `npm run dev` is running: it adds a ready 10-question demo mock (kept apart from your
own material) and prints its link.

## Run it locally

Requires Node 24. The only setting is your Anthropic API key.

```bash
npm install
cp .env.example .env.local   # then put your key after ANTHROPIC_API_KEY=
npm run dev
```

Open http://localhost:3000. Instead of (or as well as) `.env.local`, you can paste a key
in the API key field on the home page: it is kept only in that browser and takes precedence
for that browser's requests (see "Bring your own key" in docs/DECISIONS.md).

`npm run dev` also starts an embedded Postgres database
(stored in `.data/pglite`) and applies the migrations; uploads are stored in
`.data/uploads`. Both are git-ignored. Don't run `npm run build` while `npm run dev` is
running: they share the `.next` folder.

1. **Your material**: add slide PDFs, TXT or Markdown files. Each is split into chunks and
   labelled by topic. `/debug/chunks` shows every chunk and its label.
2. **Your sample exam**: add one past exam or mock. `/blueprint` shows what was learned
   from it, including the questions copied verbatim.
3. **Generate a mock**: choose 5–20 questions and a difficulty. The generation page shows
   each batch's progress.
4. **Take it**: one question at a time, marked as soon as you answer, with an explanation
   for every option. Short answers are marked by the model against the rubric.
5. **Results**: score, accuracy by topic (HOT and COLD), every question reviewable, and
   REGENERATE for a fresh mock from the same material and sample exam.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Embedded database + dev server |
| `npm run dev:next` | Dev server only, against an external `DATABASE_URL` |
| `npm run build` | Production build |
| `npm run lint` / `npm run typecheck` / `npm test` | ESLint / TypeScript / unit tests |
| `npm run db:generate` | Generate a SQL migration from `lib/db/schema.ts` into `drizzle/` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (the dev server does this itself locally) |
| `npm run db:studio` | Browse the database with Drizzle Studio (while `npm run dev` runs) |
| `npm run db:reset` | Delete the local database (stop the dev server first) |

## Where things live

- `lib/ai/`: the single model-call wrapper (structured JSON output, 429 backoff with retry
  counts, refusal handling, LaTeX repair), the per-task model map and settings
  (`config.ts`), and cost estimates (`pricing.ts`).
- `lib/ingest/`: extraction, chunking and topic labels (stage A).
- `lib/blueprint/`: blueprint extraction and its verbatim check (stage B).
- `lib/generation/`: slot plan, prompts, validation, the draft/critique/revise stage
  machine and the browser-side runner (stage C).
- `lib/storage/`: the file storage interface; `lib/storage/index.ts` picks the adapter.

## Moving to Supabase and Vercel later

Deferred until after phase 5 (see docs/DECISIONS.md). Set `DATABASE_URL` to the Supabase
pooler string, add a Supabase Storage adapter next to `lib/storage/local.ts`, point
`lib/storage/index.ts` at it, and validate the 60-second request limit on Vercel.
