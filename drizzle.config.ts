import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env.local the same way Next.js does, so drizzle-kit sees DATABASE_URL.
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
const generating = process.argv.includes("generate");
if (!url && !generating) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: url ?? "" },
  strict: true,
  verbose: true,
});
