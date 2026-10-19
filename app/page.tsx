import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "MockBuddy: practice exams from your own slides",
  description:
    "Upload your course slides and one past exam. MockBuddy deals you a brand-new mock in the same style, marks it instantly and explains every option.",
};

const STEPS = [
  {
    title: "Lay down your material",
    body: "Drop in your slide decks and notes as PDFs. MockBuddy reads them, splits them into topics, and shows you exactly what it found.",
  },
  {
    title: "Add one past exam",
    body: "Upload a past paper or mock you trust. MockBuddy learns how it's written: its sections, tone, question types and difficulty.",
  },
  {
    title: "Pull the lever",
    body: "Get a brand-new mock in that style, drawn from all of your material. Every answer is marked instantly, and every option comes with why it's right or wrong.",
  },
];

const REELS = ["Omitted variable bias", "Instrumental variables", "Heteroskedasticity"];

/**
 * The landing page: public, with one button, Sign up. The app itself lives at /app, behind a
 * login. Signed-in visitors get a link back to it and the logout button instead.
 */
export default async function LandingPage() {
  const user = await currentUser();
  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <span className="font-display text-2xl font-bold text-gold-text">MockBuddy</span>
        <nav aria-label="Account" className="flex items-center gap-4">
          {user ? <Link href="/app">Open the app</Link> : <Link href="/login">Log in</Link>}
          <LogoutButton />
        </nav>
      </header>

      <main>
        <section aria-labelledby="pitch-heading" className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-20">
          <div className="space-y-6">
            <h1 id="pitch-heading" className="font-display text-5xl leading-[1.05] font-extrabold text-cream sm:text-6xl">
              Practice exams dealt from <span className="text-gold-text">your own slides</span>.
            </h1>
            <p className="max-w-prose text-lg text-dim">
              For university students revising for an exam. Give MockBuddy your course material and one past exam. It learns how your exam is written and deals you a brand-new
              mock in the same style, drawing on everything you&rsquo;ve studied, not just the topics the old paper happened to
              cover.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href={user ? "/app" : "/signup"} className="btn-gold px-8 py-3 text-lg no-underline">
                {user ? "Open the app" : "Sign up free"}
              </Link>
              <a href="#how-it-works">How it works</a>
            </div>
          </div>

          <div aria-hidden="true" className="wood-frame rounded-[2rem] p-5">
            <div className="grid grid-cols-3 gap-3">
              {REELS.map((label) => (
                <div key={label} className="grid h-28 min-w-0 place-items-center rounded-xl bg-chip-cream px-1.5 text-center">
                  <span className="font-display text-sm leading-tight font-bold [overflow-wrap:anywhere] hyphens-auto text-card-ink sm:text-base">{label}</span>
                </div>
              ))}
            </div>
            <p className="neon mt-4 text-center text-2xl font-bold">JACKPOT — 20 questions ready</p>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-heading" className="mx-auto max-w-5xl space-y-8 px-4 py-12">
          <h2 id="how-heading" className="text-center font-display text-4xl font-bold text-gold-text">
            How it works
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="panel space-y-3 p-6">
                <span
                  aria-hidden="true"
                  className="poker-chip text-lg"
                  style={{ "--chip-color": "var(--gold)", "--chip-ink": "var(--felt-deep)", width: "3.5rem", height: "3.5rem" } as React.CSSProperties}
                >
                  {i + 1}
                </span>
                <h3 className="text-2xl font-semibold">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="text-dim">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pt-6 pb-10 text-center text-sm text-dim">
        <p>
          Every account gets 2 free mocks. The casino look is decoration only: there is no money, betting or gambling anywhere
          in MockBuddy.
        </p>
      </footer>
    </>
  );
}
