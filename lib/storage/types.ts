/**
 * Where uploaded files live. The browser never sends file bytes through an app route
 * that does work on them: it asks for an upload target, sends the bytes straight to
 * it, and passes only the storage path to the backend.
 *
 * Implementation: lib/storage/supabase.ts (Supabase Storage); lib/storage/index.ts picks it.
 */
export interface FileStorage {
  readonly kind: "supabase";

  /** A short-lived target the browser can PUT the file bytes to. */
  createUploadTarget(path: string, options: { contentType: string; maxBytes: number }): Promise<UploadTarget>;

  /** The stored bytes. Throws StorageNotFoundError when nothing is stored at `path`. */
  read(path: string): Promise<Uint8Array>;

  /** Deletes the file. Succeeds when nothing is stored at `path`. */
  remove(path: string): Promise<void>;
}

export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export class StorageNotFoundError extends Error {
  override name = "StorageNotFoundError";
  constructor(readonly path: string) {
    super(`No file is stored at ${path}. Upload it again.`);
  }
}
