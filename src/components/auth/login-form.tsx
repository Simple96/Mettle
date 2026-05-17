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
  const [submitting, setSubmitting] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function signInWithGoogle() {
    setError(null);
    setSubmitting("google");

    const supabase = createClient();
    const finalDest = next.startsWith("/") ? next : "/dashboard";

    // After Google auth, Supabase redirects to /auth/callback?code=... which
    // exchanges the code for a session and bounces to ?next.
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(finalDest)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setError(error.message);
      setSubmitting(null);
    }
    // On success the browser navigates away to Google — no further code runs.
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting("email");

    const supabase = createClient();

    // emailRedirectTo must match a Redirect URL allowlist entry in Supabase.
    // The Magic Link email template uses `{{ .SiteURL }}/auth/confirm?...&next={{ .RedirectTo }}`
    // — so this value flows through as the post-verification destination.
    const finalDest = next.startsWith("/") ? next : "/dashboard";
    const emailRedirectTo = `${window.location.origin}${finalDest}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });

    if (error) {
      setError(error.message);
      setSubmitting(null);
      return;
    }
    router.replace(`/login?sent=1&next=${encodeURIComponent(next)}`);
  }

  const busy = submitting !== null;

  return (
    <div className="auth-form-wrap">
      <button
        type="button"
        className="auth-oauth-btn"
        onClick={signInWithGoogle}
        disabled={busy}
      >
        <GoogleMark />
        <span>{submitting === "google" ? "Redirecting…" : "Continue with Google"}</span>
      </button>

      <div className="auth-divider">
        <span>or</span>
      </div>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <label className="auth-field-label" htmlFor="auth-email">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@startup.dev"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />

        <button type="submit" disabled={busy || !email}>
          {submitting === "email" ? "Sending…" : "Send magic link →"}
        </button>
      </form>

      {error ? <p className="signup-msg err">{error}</p> : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#EA4335" d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46 1 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"/>
      <path fill="#4285F4" d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"/>
      <path fill="#FBBC05" d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"/>
    </svg>
  );
}
