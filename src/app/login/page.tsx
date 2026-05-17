import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = {
  title: "Sign in — Mettle",
};

type SearchParams = Promise<{
  next?: string;
  error?: string;
  sent?: string;
}>;

export default async function LoginPage(props: { searchParams: SearchParams }) {
  const user = await getUser();
  if (user) redirect("/dashboard");

  const sp = await props.searchParams;
  const next = sp.next ?? "/dashboard";
  const sent = sp.sent === "1";
  const errorMsg = sp.error ? decodeURIComponent(sp.error) : null;

  return (
    <div className="auth-shell">
      <Link href="/" className="auth-logo">
        <span className="logo-mark" />
        <span>mettle</span>
      </Link>

      <div className="auth-card">
        <div className="signup-label">Sign in / Sign up</div>
        <h1 className="auth-title">
          Prove your <em>mettle</em>.
        </h1>
        <p className="auth-sub">
          Magic link only. No passwords, no PRs about forgotten ones.
        </p>

        {sent ? (
          <div className="auth-sent">
            <div className="auth-sent-eyebrow">Check your inbox</div>
            <p>
              If the email is valid, a sign-in link is on its way. The link
              expires in <span className="font-mono">15 minutes</span>.
            </p>
            <p className="auth-sent-hint">
              Wrong address?{" "}
              <Link href="/login" className="link">
                Try again
              </Link>
              .
            </p>
          </div>
        ) : (
          <LoginForm next={next} initialError={errorMsg} />
        )}
      </div>

      <p className="auth-foot">
        By continuing you agree to our{" "}
        <Link href="/terms" className="link">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="link">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
