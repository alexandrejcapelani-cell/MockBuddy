import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type FileStorage, StorageNotFoundError, type UploadTarget } from "./types";

// Supabase Storage, acting as the signed-in user: every call uses that user's session, so
// the bucket's RLS policies (supabase/storage.sql) decide what they can touch, and no
// secret key is needed. Paths start with the user's id, which is what those policies check.
// Only call these during a request (they read the session from its cookies).

export const BUCKET = "uploads";

export const supabaseFileStorage: FileStorage = {
  kind: "supabase",

  async createUploadTarget(path, { contentType }): Promise<UploadTarget> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(`Supabase Storage refused the upload (${error.message}). Is the "${BUCKET}" bucket set up?`);
    // The bucket enforces the size limit and file types (supabase/storage.sql).
    return { url: data.signedUrl, method: "PUT", headers: { "content-type": contentType, "x-upsert": "false" } };
  },

  async read(path) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error) {
      if (isNotFound(error)) throw new StorageNotFoundError(path);
      throw new Error(`Couldn't read ${path} from Supabase Storage: ${error.message}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  },

  async remove(path) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error && !isNotFound(error)) throw new Error(`Couldn't delete ${path} from Supabase Storage: ${error.message}`);
  },
};

function isNotFound(error: { message: string; status?: number; statusCode?: string }): boolean {
  return error.status === 404 || error.statusCode === "404" || /not.?found/i.test(error.message);
}
