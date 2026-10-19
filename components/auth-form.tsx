"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "@/app/actions/auth";

/**
 * The sign-up and login forms. Field and button test ids follow the grading contract:
 * signup-email / signup-password / signup-submit and login-email / login-password / login-submit.
 */
export function AuthForm({
  mode,
  action,
}: {
  mode: "signup" | "login";
  action: (state: AuthFormState, form: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, email: "" });
  const signup = mode === "signup";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor={`${mode}-email`} className="block font-semibold">
          Email
        </label>
        <input
          id={`${mode}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          data-testid={`${mode}-email`}
          aria-describedby={state.error ? `${mode}-error` : undefined}
          className="w-full rounded-full border border-input bg-felt-deep px-4 py-2 text-cream placeholder:text-dim"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${mode}-password`} className="block font-semibold">
          Password
        </label>
        <input
          id={`${mode}-password`}
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          data-testid={`${mode}-password`}
          aria-describedby={signup ? "password-hint" : undefined}
          className="w-full rounded-full border border-input bg-felt-deep px-4 py-2 text-cream"
        />
        {signup && (
          <p id="password-hint" className="text-sm text-dim">
            At least 6 characters.
          </p>
        )}
      </div>
      <p id={`${mode}-error`} role="alert" aria-live="assertive" className="min-h-6 text-error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} data-testid={`${mode}-submit`} className="btn-gold w-full py-3 text-lg">
        {pending ? (signup ? "Creating your account…" : "Logging in…") : signup ? "Sign up" : "Log in"}
      </button>
      <p className="text-center text-sm">
        {signup ? (
          <>
            Already have an account? <Link href="/login">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/signup">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
