import type { Metadata } from "next";
import { logIn } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Log in · MockBuddy" };

export default function LoginPage() {
  return (
    <div className="panel space-y-5 p-6 sm:p-8">
      <h1 className="font-display text-3xl font-bold text-gold-text">Log in</h1>
      <AuthForm mode="login" action={logIn} />
    </div>
  );
}
