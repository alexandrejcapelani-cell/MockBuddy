"use client";

import { useState } from "react";
import { postJson } from "@/lib/upload-client";

/** Email-only waitlist. No account, no name, nothing else stored. */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setState("sending");
    setError(null);
    const result = await postJson("/api/waitlist", { email });
    if (!result.ok) {
      setState("failed");
      setError(result.error);
      return;
    }
    setState("done");
    setEmail("");
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void join();
      }}
    >
      <label htmlFor="waitlist-email" className="block font-semibold">
        Email address
      </label>
      <div className="flex flex-wrap gap-3">
        <input
          id="waitlist-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby="waitlist-privacy"
          className="min-w-64 flex-1 rounded-full border border-input bg-felt-deep px-4 py-2 text-cream placeholder:text-dim"
          placeholder="you@university.edu"
        />
        <button type="submit" disabled={state === "sending"} className="btn-gold">
          {state === "sending" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      <p id="waitlist-privacy" className="text-sm text-dim">
        We store your email address and nothing else, only to tell you when MockBuddy opens.
      </p>
      <p aria-live="polite" className="text-sm">
        {state === "done" && <span className="text-gold-text">You&rsquo;re on the list. We&rsquo;ll be in touch.</span>}
        {state === "failed" && <span className="text-error">{error}</span>}
      </p>
    </form>
  );
}
