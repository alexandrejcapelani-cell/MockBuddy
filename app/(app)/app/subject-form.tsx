"use client";

import { useActionState } from "react";
import { createSubject, type SubjectFormState } from "./actions";

/**
 * Adds a subject: the grading contract's core feature. Typing only in core-input and
 * pressing core-submit saves it; nothing else is required.
 */
export function SubjectForm() {
  const [state, action, pending] = useActionState<SubjectFormState, FormData>(createSubject, { error: null });
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <label htmlFor="subject-name" className="block text-sm font-semibold">
          New subject
        </label>
        <input
          id="subject-name"
          name="name"
          type="text"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="e.g. Econometrics"
          data-testid="core-input"
          aria-describedby={state.error ? "subject-error" : undefined}
          className="w-full rounded-full border border-input bg-felt-deep px-4 py-2 text-cream placeholder:text-dim"
        />
      </div>
      <button type="submit" disabled={pending} data-testid="core-submit" className="btn-gold">
        {pending ? "Adding…" : "Add subject"}
      </button>
      {state.error && (
        <p id="subject-error" role="alert" className="w-full text-sm text-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
