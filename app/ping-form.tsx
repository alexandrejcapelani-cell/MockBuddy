"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPing, type PingState } from "./actions";

const initialState: PingState = { status: "idle" };

export function PingForm() {
  const [state, formAction, pending] = useActionState(createPing, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <label htmlFor="note" className="block text-sm font-medium">
        Write a row
      </label>
      <div className="flex gap-2">
        <Input
          id="note"
          name="note"
          required
          maxLength={200}
          placeholder="hello from phase 0"
          aria-describedby="ping-status"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Writing…" : "Write row"}
        </Button>
      </div>
      <p id="ping-status" aria-live="polite" className="min-h-5 text-sm">
        {state.status === "ok" && "Row written and read back below."}
        {state.status === "error" && <span className="text-destructive">Write failed: {state.message}</span>}
      </p>
    </form>
  );
}
