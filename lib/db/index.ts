import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

function createDb() {
  const url = serverEnv("DATABASE_URL");
  const client = postgres(url, {
    // Supabase's transaction pooler (port 6543, the one to use from Vercel) does not
    // support prepared statements.
    prepare: false,
    // A local Postgres stand-in may not isolate transactions between connections; one is enough.
    max: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? 1 : 5,
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

// One connection pool per server instance, cached on globalThis so dev-server hot reloads
// reuse it instead of opening a new pool on every edit. Created on first use so that
// importing this module never needs DATABASE_URL at build time.
const globalForDb = globalThis as unknown as { mockbuddyDb?: Db };

export function db(): Db {
  globalForDb.mockbuddyDb ??= createDb();
  return globalForDb.mockbuddyDb;
}
