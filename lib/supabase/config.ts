// The two Supabase values that are public by design: the project URL and the publishable
// (anon) key. Nothing secret is read here. Both are read with literal `process.env` names so
// Next.js can inline them wherever they're used.

export class SupabaseConfigError extends Error {
  override name = "SupabaseConfigError";
}

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new SupabaseConfigError("NEXT_PUBLIC_SUPABASE_URL is not set. Add your Supabase project URL to .env.local and to Vercel.");
  return url;
}

export function supabasePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) {
    throw new SupabaseConfigError(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. Add your Supabase publishable key to .env.local and to Vercel.",
    );
  }
  return key;
}
