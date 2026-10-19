// Local development entry point (`npm run dev`).
//
// 1. Opens an embedded Postgres (PGlite) persisted in .data/pglite.
// 2. Applies the migrations in drizzle/.
// 3. Serves it over the Postgres wire protocol on 127.0.0.1:5499, so the app talks to
//    it through the same postgres-js driver it will use against Supabase.
// 4. Runs `next dev` with DATABASE_URL pointing at it. Ctrl-C stops everything.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  LOCAL_DATABASE_DIR,
  LOCAL_DATABASE_HOST,
  LOCAL_DATABASE_PORT,
  LOCAL_DATABASE_URL,
} from "../lib/local-db.ts";

// Two processes opening the same PGlite directory would corrupt it, so make sure no
// other `npm run dev` holds the port before touching the data directory.
await assertPortFree(LOCAL_DATABASE_HOST, LOCAL_DATABASE_PORT);

mkdirSync(LOCAL_DATABASE_DIR, { recursive: true });
const db = new PGlite(LOCAL_DATABASE_DIR);
await db.waitReady;
await migrate(drizzle(db), { migrationsFolder: "drizzle" });
console.log(`[db] migrations applied to ${LOCAL_DATABASE_DIR}`);

// The app uses a single pooled connection to this server (lib/db/index.ts). The extra
// slots are for tools such as `npm run db:studio`.
const server = new PGLiteSocketServer({
  db,
  host: LOCAL_DATABASE_HOST,
  port: LOCAL_DATABASE_PORT,
  maxConnections: 3,
});
await server.start();
console.log(`[db] serving ${LOCAL_DATABASE_URL}`);

const next = spawn("node_modules/.bin/next", ["dev", "--turbopack", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL },
});

let stopping = false;
async function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await db.close();
  console.log("[db] stopped");
  process.exit(exitCode);
}

next.on("error", (error) => {
  console.error("[dev] could not start next dev:", error);
  void stop(1);
});
next.on("exit", (code, signal) => void stop(code ?? (signal ? 0 : 1)));
// Ctrl-C reaches next dev directly through the terminal; wait for it to exit, then close
// the database cleanly.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (next.exitCode === null) next.kill(signal);
  });
}

function assertPortFree(host, port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Is another \`npm run dev\` running? Stop it first: two servers must not open ${LOCAL_DATABASE_DIR} at once.`,
          ),
        );
      } else {
        reject(error);
      }
    });
    probe.listen(port, host, () => probe.close(resolve));
  });
}
