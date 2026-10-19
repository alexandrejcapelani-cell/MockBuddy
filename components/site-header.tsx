import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { SoundToggle } from "./sound-toggle";

/** The header on every screen of the app (not the landing page), with the logout button. */
export function SiteHeader() {
  return (
    <header className="border-b border-border/60 bg-felt-deep/70 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-display text-2xl font-bold text-gold-text no-underline hover:text-gold-bright">
          MockBuddy
        </Link>
        <nav aria-label="Main" className="flex gap-5 text-cream">
          <Link href="/app" className="text-cream hover:text-gold-bright">
            The table
          </Link>
          <Link href="/history" className="text-cream hover:text-gold-bright">
            History
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SoundToggle />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
