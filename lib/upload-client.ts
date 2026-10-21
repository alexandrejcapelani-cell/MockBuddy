// Browser-side helpers for the upload flow: ask for an upload target, send the bytes
// straight to it, then hand only the storage path to the backend.

import type { UploadKind } from "./files";

export type JsonResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> };

/**
 * POSTs JSON to one of the app's routes; the session cookie goes with it. With `timeoutMs`,
 * a request that takes longer is abandoned and answers { kind: "client_timeout" }; one the
 * caller cancels through `signal` answers { kind: "aborted" }.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<JsonResult<T>> {
  return sendJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, options);
}

/** GETs JSON from one of the app's routes, never from the cache. */
export async function getJson<T>(url: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<JsonResult<T>> {
  return sendJson<T>(url, { method: "GET", cache: "no-store" }, options);
}

async function sendJson<T>(url: string, init: RequestInit, options: { timeoutMs?: number; signal?: AbortSignal }): Promise<JsonResult<T>> {
  const signals = [
    ...(options.timeoutMs === undefined ? [] : [AbortSignal.timeout(Math.max(1, options.timeoutMs))]),
    ...(options.signal ? [options.signal] : []),
  ];
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: signals.length > 0 ? AbortSignal.any(signals) : undefined });
  } catch (error) {
    if (options.signal?.aborted) return { ok: false, status: 0, error: "The request was cancelled.", data: { kind: "aborted" } };
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, status: 0, error: "The request took too long and was stopped.", data: { kind: "client_timeout" } };
    }
    return { ok: false, status: 0, error: `Couldn't reach the app server: ${(error as Error).message}`, data: {} };
  }
  return readJson<T>(response);
}

/**
 * For a response with no message of its own (a crash, or the host stopping a request that
 * ran too long): a plain sentence, never a bare HTTP status. `status` stays on the result
 * for code that needs it.
 */
function failureMessage(status: number): string {
  return status >= 500 ? "Something went wrong on our side. Try again in a moment." : "That didn't work. Reload the page and try again.";
}

async function readJson<T>(response: Response): Promise<JsonResult<T>> {
  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, status: response.status, error: failureMessage(response.status), data };
    }
  }
  if (!response.ok) {
    const error = typeof data.error === "string" ? data.error : failureMessage(response.status);
    return { ok: false, status: response.status, error, data };
  }
  return { ok: true, data: data as T };
}

interface UploadTargetResponse {
  storagePath: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

/** Uploads straight to Supabase Storage, into the signed-in user's folder for this subject's files. */
export async function uploadFile(file: File, kind: UploadKind, subjectId: string): Promise<JsonResult<{ storagePath: string }>> {
  const target = await postJson<UploadTargetResponse>("/api/upload-url", { subjectId, kind, filename: file.name, size: file.size });
  if (!target.ok) return target;

  let response: Response;
  try {
    response = await fetch(target.data.upload.url, {
      method: target.data.upload.method,
      headers: target.data.upload.headers,
      body: file,
    });
  } catch (error) {
    return { ok: false, status: 0, error: `Uploading ${file.name} failed: ${(error as Error).message}`, data: {} };
  }
  const stored = await readJson<unknown>(response);
  if (!stored.ok) return { ...stored, error: `Uploading ${file.name} failed: ${stored.error}` };
  return { ok: true, data: { storagePath: target.data.storagePath } };
}
