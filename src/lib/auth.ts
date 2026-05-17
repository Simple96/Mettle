import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "publisher" | "operator" | "both" | "admin";

export type Profile = {
  id: string;
  email: string;
  role: AppRole;
  display_name: string | null;
  onboarded_at: string | null;
  stripe_customer_id: string | null;
  stripe_connect_account_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Returns the currently signed-in user, or null if anonymous.
 * Uses cookies refreshed by middleware.ts.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Server-component / route-handler guard. Redirects to /login if unauthenticated.
 */
export async function requireUser(redirectTo: string = "/dashboard") {
  const user = await getUser();
  if (!user) {
    const next = encodeURIComponent(redirectTo);
    redirect(`/login?next=${next}`);
  }
  return user;
}

/**
 * Fetches the profile row for the signed-in user. Returns null if no profile
 * exists yet (handle_new_user trigger normally creates one, but be defensive).
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return (data as Profile | null) ?? null;
}

/**
 * Like requireUser, but also fetches the profile and redirects to
 * /dashboard/welcome if onboarding hasn't been completed yet.
 */
export async function requireOnboardedProfile(): Promise<Profile> {
  const user = await requireUser();
  const profile = await getProfile();

  if (!profile) {
    // Trigger should have created it. If not, the user can re-login.
    redirect("/login?error=missing-profile");
  }
  if (!profile.onboarded_at) {
    redirect("/dashboard/welcome");
  }
  void user;
  return profile;
}
