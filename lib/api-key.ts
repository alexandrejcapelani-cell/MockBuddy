// Bring-your-own-key rules shared by the browser and the server.
//
// A key pasted at /app lives only in that browser's localStorage. The browser sends it in
// API_KEY_HEADER on requests that call the model (never in a URL), and the server uses it
// for that request's Gemini client only: it is never stored, logged or written to the
// database. Without the header the server falls back to GEMINI_API_KEY.
//
// MockBuddy doesn't judge what a key looks like. Google's key format has changed before
// (AI Studio has issued auth keys since May 2026) and its docs don't specify one, so any
// non-empty paste is passed on and Google's API decides. A key it rejects comes back as an
// invalid-key error with Google's own reason.

export const API_KEY_HEADER = "x-gemini-key";

/** Where the key for a model call comes from. */
export type ApiKey = { source: "browser"; value: string } | { source: "server" };

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

/** Trims the paste. Only an empty one is refused; whether the key works is Google's call. */
export function normalizeApiKey(raw: string): KeyCheck {
  const key = raw.trim();
  if (key === "") return { ok: false, message: "Paste a Gemini API key first." };
  return { ok: true, key };
}

/** "…ABCD": the last 4 characters, enough to recognise a key, never enough to use it. */
export function maskApiKey(key: string): string {
  // A very short paste would be mostly given away by its last 4 characters.
  return key.length > 8 ? `…${key.slice(-4)}` : "…";
}
