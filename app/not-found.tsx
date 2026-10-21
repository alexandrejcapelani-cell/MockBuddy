import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { NotFoundPanel } from "@/components/not-found-panel";

/**
 * A URL that matches no page. Inside the app (an exam or subject that is missing, or someone
 * else's), app/(app)/not-found.tsx answers instead, under the app's own header.
 */
export default function NotFound() {
  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-display text-2xl font-bold text-gold-text no-underline">
          MockBuddy
        </Link>
        <LogoutButton />
      </header>
      <NotFoundPanel />
    </>
  );
}
