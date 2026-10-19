"use client";

import { useState } from "react";
import { checkApiKeyFormat, maskApiKey } from "@/lib/api-key";
import { clearStoredApiKey, storeApiKey, useStoredApiKey } from "@/lib/api-key-client";

/**
 * Bring your own Anthropic API key. The key stays in this browser's localStorage and goes
 * only in a request header to this app's model-calling routes; it is never saved on the server.
 */
export function ApiKeyField({ serverKeyConfigured }: { serverKeyConfigured: boolean }) {
  const stored = useStoredApiKey();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    const check = checkApiKeyFormat(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      storeApiKey(check.key);
      setDraft("");
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  const fallback = serverKeyConfigured
    ? "Leave it empty to use ANTHROPIC_API_KEY from this server's .env.local."
    : "This server has no ANTHROPIC_API_KEY, so nothing that calls the model will work until you paste a key.";

  return (
    <section aria-labelledby="api-key-heading" className="space-y-2 rounded-lg border px-3 py-3 text-sm">
      <h2 id="api-key-heading" className="font-semibold">
        Anthropic API key
      </h2>
      {stored ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>
            Using your key <code className="font-mono">{maskApiKey(stored)}</code>
          </p>
          <button type="button" className="underline" onClick={clearStoredApiKey}>
            Clear
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label htmlFor="api-key" className="sr-only">
            Your Anthropic API key
          </label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby="api-key-help"
            className="min-w-64 flex-1 rounded border px-2 py-1 font-mono"
          />
          <button type="submit" className="rounded border px-3 py-1 font-medium">
            Use this key
          </button>
        </form>
      )}
      <p id="api-key-help" className="text-muted-foreground">
        Optional. Your key is kept only in this browser and sent only with requests that call the model; it is never
        saved on the server. {stored ? "Clear it to go back to the server's key." : fallback}
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
