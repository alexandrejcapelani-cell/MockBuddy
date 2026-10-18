import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

function createDb() {
  // prepare: false because Supabase's transaction pooler (port 6543, used on
  // Vercel) does not support prepared statements.
  const client = postgres(serverEnv("DATABASE_URL"), { prepare: false });
  return drizzle(client, { schema });
}

type Db = ReturnType<typeof createDb>;

// One connection pool per server instance, cached on globalThis so dev-server
// hot reloads reuse it instead of opening a new pool on every edit. Created on
// first use so that importing this module never needs DATABASE_URL at build time.
const globalForDb = globalThis as unknown as { mockbuddyDb?: Db };

export function db(): Db {
  globalForDb.mockbuddyDb ??= createDb();
  return globalForDb.mockbuddyDb;
}
