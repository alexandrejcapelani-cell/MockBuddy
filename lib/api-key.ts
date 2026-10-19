// Bring-your-own-key rules shared by the browser and the server.
//
// A key pasted on the home page lives only in that browser's localStorage. The browser
// sends it in API_KEY_HEADER on requests that call the model (never in a URL), and the
// server uses it for that request's Anthropic client only: it is never stored, logged or
// written to the database. Without the header the server falls back to ANTHROPIC_API_KEY.

export const API_KEY_HEADER = "x-anthropic-key";

/** Where the key for a model call comes from. */
export type ApiKey = { source: "browser"; value: string } | { source: "server" };

const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

export function checkApiKeyFormat(raw: string): KeyCheck {
  const key = raw.trim();
  if (key === "") return { ok: false, message: "Paste an Anthropic API key first." };
  if (!key.startsWith("sk-ant-")) {
    return { ok: false, message: "That isn't an Anthropic API key: they start with sk-ant-. Copy it again from the Anthropic Console." };
  }
  if (!KEY_PATTERN.test(key)) {
    return { ok: false, message: "That key looks cut off or has stray characters. Copy the whole key again from the Anthropic Console." };
  }
  return { ok: true, key };
}

/** "sk-ant-…ABCD": enough to recognise a key, never enough to use it. */
export function maskApiKey(key: string): string {
  return `sk-ant-…${key.slice(-4)}`;
}
