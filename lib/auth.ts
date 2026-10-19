import "server-only";
import { redirect } from "next/navigation";
import { RequestError } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Who is signed in, verified: getClaims() checks the session token's signature (or asks
// Supabase Auth), unlike getSession(), which only reads the cookie. Every page and route
// that touches user data starts here, even though the middleware already checked.

export interface SignedInUser {
  id: string;
  email: string | null;
}

export async function currentUser(): Promise<SignedInUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

/** For pages and Server Actions: the signed-in user, or a redirect to /login. */
export async function requireUser(): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For API routes: the signed-in user, or a 401. */
export async function requireApiUser(): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) throw new RequestError("Log in to do that.", 401);
  return user;
}
