import Link from "next/link";

/** The body of every 404, which also answers for other users' exams and subjects. */
export function NotFoundPanel() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="panel space-y-4 p-6">
        <h1 className="font-display text-3xl font-bold text-gold-text">Not on this table</h1>
        <p>That page doesn&rsquo;t exist, or it isn&rsquo;t yours.</p>
        <Link href="/app" className="btn-gold inline-block no-underline">
          Back to the table
        </Link>
      </div>
    </main>
  );
}
