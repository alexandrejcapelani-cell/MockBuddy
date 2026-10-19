import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

/** Sign-up and login: the logo, and a logout button if someone is already signed in. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-display text-2xl font-bold text-gold-text no-underline">
          MockBuddy
        </Link>
        <LogoutButton />
      </header>
      <main className="mx-auto max-w-md px-4 py-8">{children}</main>
    </>
  );
}
