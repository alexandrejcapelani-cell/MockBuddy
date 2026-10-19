// Browser-side helpers for the upload flow: ask for an upload target, send the bytes
// straight to it, then hand only the storage path to the backend.

import { apiKeyHeaders } from "./api-key-client.ts";
import type { UploadKind } from "./files";

export type JsonResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> };

/**
 * POSTs JSON. `withApiKey` adds the key pasted in this browser, if any, as a header: use it
 * only for routes that call the model.
 */
export async function postJson<T>(url: string, body: unknown, options: { withApiKey?: boolean } = {}): Promise<JsonResult<T>> {
  const headers = { "Content-Type": "application/json", ...(options.withApiKey ? apiKeyHeaders() : {}) };
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (error) {
    return { ok: false, status: 0, error: `Couldn't reach the app server: ${(error as Error).message}`, data: {} };
  }
  return readJson<T>(response);
}

async function readJson<T>(response: Response): Promise<JsonResult<T>> {
  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, status: response.status, error: `The server answered ${response.status} with a non-JSON body.`, data };
    }
  }
  if (!response.ok) {
    const error = typeof data.error === "string" ? data.error : `The server answered ${response.status}.`;
    return { ok: false, status: response.status, error, data };
  }
  return { ok: true, data: data as T };
}

interface UploadTargetResponse {
  storagePath: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

export async function uploadFile(file: File, kind: UploadKind): Promise<JsonResult<{ storagePath: string }>> {
  const target = await postJson<UploadTargetResponse>("/api/upload-url", { kind, filename: file.name, size: file.size });
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
