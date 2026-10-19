import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type FileStorage, StorageNotFoundError, type UploadTarget } from "./types";

// Local stand-in for Supabase Storage: files live under .data/uploads, and upload
// targets are signed URLs to app/api/local-upload, which only writes bytes to disk.

const ROOT = path.resolve(process.cwd(), ".data/uploads");
const UPLOAD_TTL_MS = 10 * 60 * 1000;

// Signing key for upload URLs. A new one per server process is fine: a URL only has to
// survive the few seconds between issuing it and the browser using it.
const globalForStorage = globalThis as unknown as { mockbuddyUploadKey?: Buffer };
const signingKey = (globalForStorage.mockbuddyUploadKey ??= randomBytes(32));

export class UploadRejectedError extends Error {
  override name = "UploadRejectedError";
  constructor(
    message: string,
    readonly status: 400 | 403 | 413,
  ) {
    super(message);
  }
}

export const localFileStorage: FileStorage = {
  kind: "local",

  async createUploadTarget(storagePath, { contentType, maxBytes }): Promise<UploadTarget> {
    resolveInRoot(storagePath);
    const expires = Date.now() + UPLOAD_TTL_MS;
    const params = new URLSearchParams({
      path: storagePath,
      expires: String(expires),
      max: String(maxBytes),
    });
    params.set("sig", sign(params));
    return { url: `/api/local-upload?${params}`, method: "PUT", headers: { "Content-Type": contentType } };
  },

  async read(storagePath) {
    const file = resolveInRoot(storagePath);
    try {
      return new Uint8Array(await readFile(file));
    } catch (error) {
      if (isNotFound(error)) throw new StorageNotFoundError(storagePath);
      throw error;
    }
  },

  async remove(storagePath) {
    await rm(resolveInRoot(storagePath), { force: true });
  },
};

/** Called by app/api/local-upload: checks the signature, then writes the bytes. */
export async function acceptLocalUpload(params: URLSearchParams, body: ArrayBuffer): Promise<string> {
  const storagePath = params.get("path");
  const expires = Number(params.get("expires"));
  const maxBytes = Number(params.get("max"));
  const signature = params.get("sig");
  if (!storagePath || !signature || !Number.isFinite(expires) || !Number.isFinite(maxBytes)) {
    throw new UploadRejectedError("Malformed upload URL.", 400);
  }
  const unsigned = new URLSearchParams(params);
  unsigned.delete("sig");
  if (!signatureMatches(sign(unsigned), signature)) {
    throw new UploadRejectedError("Upload URL signature is invalid. Request a new one.", 403);
  }
  if (Date.now() > expires) throw new UploadRejectedError("Upload URL has expired. Request a new one.", 403);
  if (body.byteLength > maxBytes) {
    throw new UploadRejectedError(`File is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, 413);
  }

  const file = resolveInRoot(storagePath);
  await mkdir(path.dirname(file), { recursive: true });
  // Write to a temporary name and rename, so a half-written file is never readable.
  const temporary = `${file}.${randomBytes(6).toString("hex")}.part`;
  await writeFile(temporary, new Uint8Array(body));
  await rename(temporary, file);
  return storagePath;
}

function sign(params: URLSearchParams): string {
  return createHmac("sha256", signingKey).update(params.toString()).digest("base64url");
}

function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Maps a storage path to a file under ROOT, refusing anything that could escape it. */
function resolveInRoot(storagePath: string): string {
  const segments = storagePath.split("/");
  if (segments.length === 0 || segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment) || /^\.+$/.test(segment))) {
    throw new UploadRejectedError(`Invalid storage path: ${storagePath}`, 400);
  }
  const resolved = path.resolve(ROOT, ...segments);
  if (!resolved.startsWith(ROOT + path.sep)) throw new UploadRejectedError(`Invalid storage path: ${storagePath}`, 400);
  return resolved;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
