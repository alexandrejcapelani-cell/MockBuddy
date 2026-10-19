import { ConfigError } from "@/lib/env";

/**
 * Turns a database failure into one readable sentence for the UI, with a fix
 * when the cause is a known setup mistake. Callers still log the full error.
 */
export function describeDbError(error: unknown): string {
  if (error instanceof ConfigError) return error.message;

  // Drizzle wraps driver errors ("Failed query: …"); the driver error underneath
  // carries the Postgres SQLSTATE or the network error code.
  const root = rootCause(error);
  const message = root instanceof Error ? root.message : String(root);
  const code = errorCode(root);
  const hint = hintFor(message, code);
  return hint ? `${message} (${hint})` : message;
}

function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error && current.cause !== undefined; depth++) {
    current = current.cause;
  }
  return current;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return undefined;
}

function hintFor(message: string, code: string | undefined): string | undefined {
  switch (code) {
    case "ENOTFOUND":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return "database host unreachable: use a Supabase pooler connection string (…pooler.supabase.com), not the direct db.<ref>.supabase.co one, which is IPv6-only";
    case "28P01":
      return "wrong password in DATABASE_URL; special characters in the password must be URL-encoded";
    case "42P01":
    case "42704":
      return "the schema is missing: run `npm run db:migrate`";
    case "CONNECT_TIMEOUT":
    case "ETIMEDOUT":
    case "ECONNREFUSED":
      return process.env.NODE_ENV === "production"
        ? "could not open a connection: check the host and port in DATABASE_URL, and that the Supabase project is not paused"
        : "could not reach the local database: start the app with `npm run dev`, which starts the database too";
  }
  if (/prepared statement/i.test(message)) {
    return "the transaction pooler rejected a prepared statement: the client must be created with prepare: false";
  }
  return undefined;
}
