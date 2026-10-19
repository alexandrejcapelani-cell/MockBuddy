import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import { isLocalDatabaseUrl } from "@/lib/local-db";
import * as schema from "./schema";

function createDb() {
  const url = serverEnv("DATABASE_URL");
  const client = postgres(url, {
    // Supabase's transaction pooler (port 6543, used on Vercel) does not support
    // prepared statements.
    prepare: false,
    // The embedded PGlite server runs one query at a time and does not isolate
    // transactions between connections, so the app keeps a single connection to it.
    max: isLocalDatabaseUrl(url) ? 1 : 10,
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

// One connection pool per server instance, cached on globalThis so dev-server
// hot reloads reuse it instead of opening a new pool on every edit. Created on
// first use so that importing this module never needs DATABASE_URL at build time.
const globalForDb = globalThis as unknown as { mockbuddyDb?: Db };

export function db(): Db {
  globalForDb.mockbuddyDb ??= createDb();
  return globalForDb.mockbuddyDb;
}
