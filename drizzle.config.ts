import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env.local the same way Next.js does. `db:generate` needs no database; the other
// drizzle-kit commands use DATABASE_URL (your Supabase connection string).
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Supabase's own roles (anon, authenticated…) and schemas (auth, storage) already exist.
  entities: { roles: { provider: "supabase" } },
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
