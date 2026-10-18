# MockBuddy

Turns a student's own course material into realistic practice exams, in the style of one
sample exam. The full product spec is in [MOCKBUDDY_SPEC.md](MOCKBUDDY_SPEC.md).

Stack: Next.js 15 (App Router) · Tailwind + shadcn/ui · Supabase (Postgres + Storage) ·
Drizzle ORM + postgres-js · Anthropic API · Zod · KaTeX · unpdf.

## Status

Phase 0: scaffold, database connection, schema and migration, and a home page that
writes and reads a row (the `pings` table).

## Local setup

Requires Node 24.

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run db:migrate           # applies drizzle/*.sql to DATABASE_URL
npm run dev
```

In `.env.local`, use Supabase's **Session pooler** connection string (port 5432). Vercel uses
the **Transaction pooler** string (port 6543). Both are under **Connect** in the Supabase
dashboard. Never commit `.env.local`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:generate` | Generate a SQL migration from `lib/db/schema.ts` into `drizzle/` |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:studio` | Browse the database with Drizzle Studio |

## Environment variables

| Name | Where it is used |
| --- | --- |
| `DATABASE_URL` | Server only. Postgres connection string (see pooler note above) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Signed upload URLs (phase 1) |
| `ANTHROPIC_API_KEY` | Server only. Model calls (phase 1 onwards) |
| `DEMO_USER_ID` | The single hard-coded user, `demo` |

Server-only values are read exclusively through `lib/env.ts`, which imports `server-only`,
so any client component that imports it fails the build.

## Database notes

- Row level security is enabled on every table with no policies, so Supabase's public Data
  API cannot read or write anything. The app connects as `postgres`, which owns the tables.
- Schema changes: edit `lib/db/schema.ts`, run `npm run db:generate`, commit the new file in
  `drizzle/`, then run `npm run db:migrate`.
