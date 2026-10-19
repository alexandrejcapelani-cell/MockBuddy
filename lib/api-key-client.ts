// Browser side of bring-your-own-key: the pasted key lives in this browser's localStorage
// and nowhere else. Requests that call the model send it in a header (see lib/api-key.ts).

import { useSyncExternalStore } from "react";
import { API_KEY_HEADER } from "./api-key.ts";

const STORAGE_KEY = "mockbuddy.geminiApiKey";
/** Where the Anthropic key was kept before the switch to Gemini; removed so it doesn't linger. */
const LEGACY_STORAGE_KEY = "mockbuddy.anthropicApiKey";
const CHANGE_EVENT = "mockbuddy:api-key-changed";

/** The stored key, or null. Storage can be unavailable (blocked or private mode): that reads as no key. */
export function readStoredApiKey(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Saves the key. Throws when the browser refuses storage, so the caller can say so. */
export function storeApiKey(key: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch (error) {
    throw new Error(`This browser wouldn't save the key (${(error as Error).message}). Local storage may be blocked or full.`);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearStoredApiKey(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } finally {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

/** Headers carrying the stored key, or none when no key is stored. */
export function apiKeyHeaders(): Record<string, string> {
  const key = readStoredApiKey();
  return key ? { [API_KEY_HEADER]: key } : {};
}

function subscribe(onChange: () => void): () => void {
  removeLegacyKey();
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function removeLegacyKey(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage is unavailable, so there is nothing stored to remove.
  }
}

/** The stored key, kept up to date across components and tabs. Null during server rendering. */
export function useStoredApiKey(): string | null {
  return useSyncExternalStore(subscribe, readStoredApiKey, () => null);
}
