import type { Metadata } from "next";
import { signUp } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign up · MockBuddy" };

export default function SignupPage() {
  return (
    <div className="panel space-y-5 p-6 sm:p-8">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold text-gold-text">Create your account</h1>
        <p className="text-dim">Free. Just an email and a password; no confirmation email.</p>
      </div>
      <AuthForm mode="signup" action={signUp} />
    </div>
  );
}
