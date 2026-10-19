// The embedded Postgres (PGlite) that `npm run dev` starts; see scripts/dev.mjs.
// Plain Node scripts import this file too, so it must stay free of Next.js-only imports.

export const LOCAL_DATABASE_HOST = "127.0.0.1";
export const LOCAL_DATABASE_PORT = 5499;
export const LOCAL_DATABASE_DIR = ".data/pglite";
export const LOCAL_DATABASE_URL = `postgresql://postgres:postgres@${LOCAL_DATABASE_HOST}:${LOCAL_DATABASE_PORT}/postgres`;

export function isLocalDatabaseUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { hostname } = new URL(url);
  return hostname === "127.0.0.1" || hostname === "localhost";
}
