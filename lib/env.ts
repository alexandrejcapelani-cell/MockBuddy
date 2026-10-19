import "server-only";
import { z } from "zod";
import { LOCAL_DATABASE_URL } from "@/lib/local-db";

/**
 * Every environment variable the server reads. Each one is validated when it is
 * first used, not at import time, so `next build` succeeds before every variable
 * is configured and a missing key fails with a message that names it.
 *
 * Secrets (ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY) are only ever read here,
 * and `server-only` makes any client-component import of this module a build error.
 */
const schemas = {
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must be a postgres:// or postgresql:// connection string"),
  DEMO_USER_ID: z.string().trim().min(1),
  ANTHROPIC_API_KEY: z.string().trim().min(1),
  // Not used while files are stored locally; the Supabase storage adapter will read them.
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.url("must be your Supabase project URL, e.g. https://<ref>.supabase.co"),
} as const;

type EnvKey = keyof typeof schemas;

// Used when the variable is unset. DATABASE_URL only falls back outside production, to
// the embedded database `npm run dev` starts, so a deployment without it still fails loudly.
const defaults: Partial<Record<EnvKey, string>> = { DEMO_USER_ID: "demo" };
const developmentDefaults: Partial<Record<EnvKey, string>> = { DATABASE_URL: LOCAL_DATABASE_URL };

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function serverEnv<K extends EnvKey>(key: K): z.output<(typeof schemas)[K]> {
  const raw = nonEmpty(process.env[key]) ?? defaults[key] ?? developmentDefault(key);
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

function developmentDefault(key: EnvKey): string | undefined {
  return process.env.NODE_ENV === "production" ? undefined : developmentDefaults[key];
}
