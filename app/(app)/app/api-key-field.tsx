"use client";

import { useState } from "react";
import { maskApiKey, normalizeApiKey } from "@/lib/api-key";
import { clearStoredApiKey, storeApiKey, useStoredApiKey } from "@/lib/api-key-client";

/**
 * Bring your own Gemini API key. The key stays in this browser's localStorage and goes
 * only in a request header to this app's model-calling routes; it is never saved on the server.
 */
export function ApiKeyField({ serverKeyConfigured }: { serverKeyConfigured: boolean }) {
  const stored = useStoredApiKey();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    const check = normalizeApiKey(draft);
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
    ? "Leave it empty to use GEMINI_API_KEY from this server's .env.local."
    : "This server has no GEMINI_API_KEY, so nothing that calls the model will work until you paste a key.";

  return (
    <section aria-labelledby="api-key-heading" className="panel space-y-2 px-4 py-3 text-sm">
      <h2 id="api-key-heading" className="font-sans text-base font-semibold">
        Gemini API key
      </h2>
      {stored ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>
            Using your key <code className="font-mono text-gold-text">{maskApiKey(stored)}</code>
          </p>
          <button type="button" className="btn-quiet text-sm" onClick={clearStoredApiKey}>
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
            Your Gemini API key
          </label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby="api-key-help"
            className="min-w-64 flex-1 rounded-full border border-input bg-felt-deep px-4 py-2 font-mono text-cream placeholder:text-dim"
          />
          <button type="submit" className="btn-gold text-sm">
            Use this key
          </button>
        </form>
      )}
      <p id="api-key-help" className="text-dim">
        Optional. Create a free key in{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          Google AI Studio
        </a>
        . Your key is kept only in this browser and sent only with requests that call the model; it is never saved on the
        server. {stored ? "Clear it to go back to the server's key." : fallback}
      </p>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </section>
  );
}
