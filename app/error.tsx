"use client";

import Link from "next/link";

// Shown when a page fails to render, e.g. when the local database isn't running.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-16">
      <div className="panel space-y-4 p-6">
        <h1 className="font-display text-3xl font-bold text-gold-text">The house has a problem</h1>
        <p role="alert" className="text-error">
          {error.message}
        </p>
        {error.digest && <p className="text-sm text-dim">Error reference: {error.digest}</p>}
        <p className="text-sm text-dim">
          If this says the database is unreachable, start the app with <code>npm run dev</code>, which starts the local
          database too.
        </p>
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
  );
}
