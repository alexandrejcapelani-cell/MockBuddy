// Bring-your-own-key rules shared by the browser and the server.
//
// A key pasted at /app lives only in that browser's localStorage. The browser sends it in
// API_KEY_HEADER on requests that call the model (never in a URL), and the server uses it
// for that request's Gemini client only: it is never stored, logged or written to the
// database. Without the header the server falls back to GEMINI_API_KEY.

export const API_KEY_HEADER = "x-gemini-key";

/** Where the key for a model call comes from. */
export type ApiKey = { source: "browser"; value: string } | { source: "server" };

/** Gemini API keys are Google Cloud API keys: "AIza" and 35 more characters. A little slack in case that grows. */
const KEY_PATTERN = /^AIza[A-Za-z0-9_-]{30,100}$/;

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

export function checkApiKeyFormat(raw: string): KeyCheck {
  const key = raw.trim();
  if (key === "") return { ok: false, message: "Paste a Gemini API key first." };
  if (!key.startsWith("AIza")) {
    return { ok: false, message: "That isn't a Gemini API key: they start with AIza. Copy it again from Google AI Studio." };
  }
  if (!KEY_PATTERN.test(key)) {
    return { ok: false, message: "That key looks cut off or has stray characters. Copy the whole key again from Google AI Studio." };
  }
  return { ok: true, key };
}

/** "AIza…ABCD": enough to recognise a key, never enough to use it. */
export function maskApiKey(key: string): string {
  return `AIza…${key.slice(-4)}`;
}
