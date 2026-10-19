import "server-only";
import { supabaseFileStorage } from "./supabase";
import type { FileStorage } from "./types";

// The one place that chooses where uploads live.
export const storage: FileStorage = supabaseFileStorage;

export { StorageNotFoundError, type FileStorage, type UploadTarget } from "./types";
