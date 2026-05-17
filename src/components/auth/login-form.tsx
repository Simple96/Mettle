"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  next: string;
  initialError?: string | null;
};

export function LoginForm({ next, initialError }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const supabase = createClient();
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });

    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }
    router.replace(`/login?sent=1&next=${encodeURIComponent(next)}`);
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <label className="auth-field-label" htmlFor="auth-email">
        Email
      </label>
      <input
        id="auth-email"
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@startup.dev"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
      />

      <button type="submit" disabled={submitting || !email}>
        {submitting ? "Sending…" : "Send magic link →"}
      </button>

      {error ? <p className="signup-msg err">{error}</p> : null}
    </form>
  );
}
