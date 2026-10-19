import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "./config";

/**
 * A Supabase client for this request, acting as the signed-in user (their session comes
 * from the request cookies). Use it in Server Components, Server Actions and Route
 * Handlers; create one per request, never share it. Storage calls made with it are
 * subject to the Storage RLS policies in supabase/storage.sql.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies. The middleware refreshes the session on
          // every request, so a refresh noticed here has already been written there.
        }
      },
    },
  });
}
