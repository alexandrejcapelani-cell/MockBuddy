import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

/** Also used for other users' exams and subjects, which answer exactly like missing ones. */
export default function NotFound() {
  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-display text-2xl font-bold text-gold-text no-underline">
          MockBuddy
        </Link>
        <LogoutButton />
      </header>
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="panel space-y-4 p-6">
          <h1 className="font-display text-3xl font-bold text-gold-text">Not on this table</h1>
          <p>That page doesn&rsquo;t exist, or it isn&rsquo;t yours.</p>
          <Link href="/app" className="btn-gold inline-block no-underline">
            Back to the table
          </Link>
        </div>
      </main>
    </>
  );
}
