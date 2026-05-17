import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Magic-link / email-confirm landing endpoint (token-hash flow).
 *
 * This is the SSR-compatible flow for Supabase Auth. Email template MUST link
 * here (NOT to Supabase's hosted /auth/v1/verify):
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next={{ .RedirectTo }}
 *
 * Unlike the legacy /verify flow (which uses implicit grants and #-hash
 * fragments), this route exchanges the token server-side and writes the
 * Supabase auth cookies via @supabase/ssr — so the user is signed in by
 * the time they hit /dashboard.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const rawNext = url.searchParams.get("next") || "/dashboard";

  // `next` may be either a relative path (preferred) or a full URL — Supabase
  // templates often pass `{{ .RedirectTo }}` directly, which is the absolute
  // emailRedirectTo value. Normalize to a same-origin relative path or fall
  // back to /dashboard. Never redirect off-origin.
  let safeNext = "/dashboard";
  if (rawNext.startsWith("/") && !rawNext.startsWith("//")) {
    safeNext = rawNext;
  } else {
    try {
      const u = new URL(rawNext);
      if (u.origin === url.origin) {
        safeNext = (u.pathname + u.search + u.hash) || "/dashboard";
      }
    } catch {
      // ignored — fall through to /dashboard
    }
  }

  if (!token_hash || !type) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("Missing or malformed sign-in link.")}`,
        url.origin
      )
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(
          error.message === "Token has expired or is invalid"
            ? "That sign-in link has expired or was already used. Send a new one."
            : error.message
        )}`,
        url.origin
      )
    );
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
