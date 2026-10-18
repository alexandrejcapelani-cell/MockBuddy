import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { describeDbError } from "@/lib/db/errors";
import { pings } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { PingForm } from "./ping-form";

// Reads the database on every request; never prerendered at build time.
export const dynamic = "force-dynamic";

async function loadPings() {
  const started = performance.now();
  const rows = await db()
    .select()
    .from(pings)
    .where(eq(pings.userId, serverEnv("DEMO_USER_ID")))
    .orderBy(desc(pings.createdAt))
    .limit(10);
  return { rows, ms: Math.round(performance.now() - started) };
}

/** host:port of DATABASE_URL, never the credentials. Shows which pooler is in use. */
function databaseEndpoint(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url || !URL.canParse(url)) return null;
  const { hostname, port } = new URL(url);
  return `${hostname}:${port || "5432"}`;
}

export default async function Home() {
  const result = await loadPings().then(
    (data) => ({ ok: true as const, ...data }),
    (error: unknown) => {
      console.error("Reading pings failed", error);
      return { ok: false as const, message: describeDbError(error) };
    },
  );
  const endpoint = databaseEndpoint();

  return (
    <main className="mx-auto max-w-xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MockBuddy</h1>
        <p className="text-sm text-muted-foreground">Phase 0: database round-trip check</p>
        {endpoint && <p className="font-mono text-xs text-muted-foreground">Database: {endpoint}</p>}
      </header>

      <PingForm />

      <section aria-labelledby="rows-heading" className="space-y-2">
        <h2 id="rows-heading" className="font-medium">
          Latest rows
        </h2>
        {!result.ok ? (
          <p role="alert" className="text-sm text-destructive">
            Could not read from the database: {result.message}
          </p>
        ) : result.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows yet. Write one above.</p>
        ) : (
          <>
            <ul className="divide-y rounded-lg border text-sm">
              {result.rows.map((row) => (
                <li key={row.id} className="flex justify-between gap-4 px-3 py-2">
                  <span className="break-all">{row.note}</span>
                  <time dateTime={row.createdAt.toISOString()} className="shrink-0 text-muted-foreground tabular-nums">
                    {row.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
                  </time>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Read in {result.ms} ms.</p>
          </>
        )}
      </section>
    </main>
  );
}
