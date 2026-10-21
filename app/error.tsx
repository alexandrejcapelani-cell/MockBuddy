"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { logOut } from "@/app/actions/auth";

// Shown when a page fails to render, in place of everything under the root layout (the app's
// header included), so it has its own header and logout button. In production Next.js hides
// the message and shows only the reference, which matches the server log.

/** Supabase's session cookie (sb-<ref>-auth-token, possibly split into .0, .1…) isn't HttpOnly. */
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/;
const noSubscription = () => () => {};

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // A crash may come from the sign-in check itself, so the cookie is the one safe signal.
  const signedIn = useSyncExternalStore(noSubscription, () => SESSION_COOKIE.test(document.cookie), () => false);
  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-display text-2xl font-bold text-gold-text no-underline">
          MockBuddy
        </Link>
        {signedIn && (
          <form action={logOut}>
            <button type="submit" data-testid="logout" className="btn-quiet text-sm whitespace-nowrap">
              Log out
            </button>
          </form>
        )}
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-16">
        <div className="panel space-y-4 p-6">
          <h1 className="font-display text-3xl font-bold text-gold-text">The house has a problem</h1>
          <p role="alert" className="text-error">
            {error.message}
          </p>
          {error.digest && <p className="text-sm text-dim">Error reference: {error.digest}</p>}
          <p className="text-sm text-dim">Nothing you saved is lost. Try again, or go back to the table.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-gold" onClick={reset}>
              Try again
            </button>
            <Link href="/app" className="btn-quiet no-underline">
              Back to the table
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
