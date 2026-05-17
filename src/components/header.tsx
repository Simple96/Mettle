import { getProfile } from "@/lib/auth";
import { HeaderClient } from "./header-client";

/**
 * Top-level site header used by all public-facing layouts (landing,
 * arena, legal). Server component: fetches the auth profile so the client
 * variant can swap chrome between marketing and signed-in app modes.
 *
 * Logged out  → marketing nav with "Sign in" CTA.
 * Logged in   → app topbar (matches /dashboard) so navigating between
 *               public pages and the dashboard feels like one product.
 */
export async function Header() {
  const profile = await getProfile();
  return (
    <HeaderClient
      user={
        profile
          ? {
              displayName:
                profile.display_name ??
                profile.email?.split("@")[0] ??
                "you",
              role: profile.role,
              onboarded: !!profile.onboarded_at,
            }
          : null
      }
    />
  );
}
