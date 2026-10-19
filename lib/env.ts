import "server-only";
import { z } from "zod";

/**
 * The server-only environment variables. Each one is validated when it is first used, not
 * at import time, so `next build` succeeds before every variable is configured and a
 * missing one fails with a message that names it.
 *
 * Both secrets (DATABASE_URL, which holds the database password, and GEMINI_API_KEY) are
 * read only here, and `server-only` makes any client-component import of this module a
 * build error. The public Supabase URL and publishable key are in lib/supabase/config.ts.
 */
const schemas = {
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must be a postgres:// or postgresql:// connection string"),
  GEMINI_API_KEY: z.string().trim().min(1),
  // Which Gemini plan the key is on. The API doesn't say, and it decides whether calls cost anything.
  GEMINI_TIER: z.enum(["free", "paid"], "must be free or paid"),
} as const;

type EnvKey = keyof typeof schemas;

const defaults: Partial<Record<EnvKey, string>> = { GEMINI_TIER: "free" };

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function serverEnv<K extends EnvKey>(key: K): z.output<(typeof schemas)[K]> {
  const raw = nonEmpty(process.env[key]) ?? defaults[key];
  if (raw === undefined) {
    throw new ConfigError(
      `${key} is not set. Add it to .env.local for local development, or to Vercel → Project → Settings → Environment Variables for deployments.`,
    );
  }
  const parsed = schemas[key].safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`${key} is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data as z.output<(typeof schemas)[K]>;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}
