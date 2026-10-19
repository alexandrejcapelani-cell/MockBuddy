// Browser-side helpers for the upload flow: ask for an upload target, send the bytes
// straight to it, then hand only the storage path to the backend.

import type { UploadKind } from "./files";

export type JsonResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> };

/** POSTs JSON to one of the app's routes; the session cookie goes with it. */
export async function postJson<T>(url: string, body: unknown): Promise<JsonResult<T>> {
  const headers = { "Content-Type": "application/json" };
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
