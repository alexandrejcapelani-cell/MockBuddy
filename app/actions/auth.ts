"use server";

import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Email + password accounts through Supabase Auth. Passwords go only to Supabase; nothing
// here logs or stores them. After sign-up and after login, the user lands on /app.

export interface AuthFormState {
  error: string | null;
  /** Kept so a failed attempt doesn't clear the email field. Never the password. */
  email: string;
}

function credentials(form: FormData) {
  return { email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "") };
}

export async function signUp(_previous: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { email, password } = credentials(form);
  if (email === "" || password === "") return { error: "Enter your email and choose a password.", email };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: signUpMessage(error), email };
  if (!data.session) {
    // Only happens if the Supabase project still has "Confirm email" switched on.
    return {
      error:
        "Your account was created, but this Supabase project asks new users to confirm their email first, which MockBuddy doesn't support. The site owner needs to turn off Confirm email in Supabase (Authentication → Sign In / Providers → Email).",
      email,
    };
  }
  redirect("/app");
}

export async function logIn(_previous: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { email, password } = credentials(form);
  if (email === "" || password === "") return { error: "Enter your email and password.", email };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: logInMessage(error), email };
  redirect("/app");
}

export async function logOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

function signUpMessage(error: AuthError): string {
  switch (error.code) {
    case "user_already_exists":
    case "email_exists":
      return "There's already an account with this email. Log in instead.";
    case "weak_password":
      return error.message || "Choose a longer password.";
    case "email_address_invalid":
      return "That email address doesn't look right. Check it and try again.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many sign-ups from here just now. Wait a minute and try again.";
    default:
      return `Couldn't create your account: ${error.message}`;
  }
}

function logInMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Wrong email or password.";
    case "email_not_confirmed":
      return "This account's email isn't confirmed, and MockBuddy doesn't send confirmation emails. Sign up again with a new address, or ask the site owner to turn off Confirm email in Supabase.";
    case "over_request_rate_limit":
      return "Too many attempts just now. Wait a minute and try again.";
    default:
      return `Couldn't log you in: ${error.message}`;
  }
}
