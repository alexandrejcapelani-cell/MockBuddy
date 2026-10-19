import "server-only";
import { localFileStorage } from "./local";
import type { FileStorage } from "./types";

// The one place that chooses where uploads live. To move to Supabase Storage, add
// lib/storage/supabase.ts implementing FileStorage and point this line at it.
export const storage: FileStorage = localFileStorage;

export { StorageNotFoundError, type FileStorage, type UploadTarget } from "./types";
