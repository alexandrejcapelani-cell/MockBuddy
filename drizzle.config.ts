import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";
import { LOCAL_DATABASE_URL } from "./lib/local-db";

// Load .env.local the same way Next.js does. Without DATABASE_URL, drizzle-kit talks to
// the embedded database that `npm run dev` serves (which also applies migrations itself).
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || LOCAL_DATABASE_URL },
  strict: true,
  verbose: true,
});
