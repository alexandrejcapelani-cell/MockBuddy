"use client";

// Shown when a page fails to render, e.g. when the local database isn't running.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p role="alert" className="text-destructive">
        {error.message}
      </p>
      {error.digest && <p className="text-sm text-muted-foreground">Error reference: {error.digest}</p>}
      <p className="text-sm">
        If this says the database is unreachable, start the app with <code>npm run dev</code>, which starts the local
        database too.
      </p>
      <button type="button" className="underline" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
