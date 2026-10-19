import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

// Runs on every page and API request: refreshes the Supabase session cookies, and keeps
// everything except the landing, sign-up and login pages behind a login. Pages redirect to
// /login; API routes answer 401. The pages and routes check the user again themselves.

const PUBLIC_PATHS = new Set(["/", "/login", "/signup"]);

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });

  // getClaims() verifies the session token; never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;
  if (signedIn || PUBLIC_PATHS.has(pathname)) return response;

  const denied = pathname.startsWith("/api/")
    ? NextResponse.json({ error: "Log in to do that.", kind: "unauthenticated" }, { status: 401 })
    : NextResponse.redirect(new URL("/login", request.url));
  // Keep any cookie changes (for example a cleared, expired session) on the new response.
  for (const cookie of response.cookies.getAll()) denied.cookies.set(cookie);
  return denied;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
