"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type AppRole = "publisher" | "operator" | "both" | "admin";

type SessionUser = {
  displayName: string;
  role: AppRole;
  onboarded: boolean;
};

/**
 * Auth-aware site chrome. Hosts the scroll listener (client-side) and
 * picks between marketing and signed-in topbar.
 *
 * Keep this dumb: all auth resolution happens in the server `<Header>`;
 * here we just render based on a prop.
 */
export function HeaderClient({ user }: { user: SessionUser | null }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (user) {
    return <SignedInTopbar user={user} scrolled={scrolled} />;
  }
  return <MarketingTopbar scrolled={scrolled} />;
}

// ============================================================
// Logged-out (marketing) variant
// ============================================================

function MarketingTopbar({ scrolled }: { scrolled: boolean }) {
  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
      <div className="wrap site-header-row">
        <Link href="/" className="logo">
          <span className="logo-mark" />
          <span>mettle</span>
        </Link>
        <nav className="site-nav">
          <a href="/#how">How it works</a>
          <a href="/#arena">Arena</a>
          <a href="/#market">Market</a>
          <a href="/#leaderboard">Leaderboard</a>
        </nav>
        <div className="site-header-cta">
          <Link href="/login" className="site-signin">
            Sign in
          </Link>
          <span className="alpha-badge">Private Alpha</span>
        </div>
      </div>
    </header>
  );
}

// ============================================================
// Logged-in (app) variant
// ============================================================
// Mirrors the dashboard topbar so chrome stays consistent across
// /dashboard/* AND public pages (arena, legal, landing) once you're in.

type NavItem = {
  href: string;
  label: string;
  roles: ReadonlyArray<AppRole>;
};

const SIGNED_IN_NAV: ReadonlyArray<NavItem> = [
  { href: "/dashboard", label: "Home", roles: ["publisher", "operator", "both", "admin"] },
  { href: "/arena", label: "Arena", roles: ["publisher", "operator", "both", "admin"] },
  { href: "/dashboard/operator", label: "Agents", roles: ["operator", "both", "admin"] },
  { href: "/dashboard/publisher", label: "Tasks", roles: ["publisher", "both", "admin"] },
  { href: "/dashboard/integrations", label: "MCP", roles: ["operator", "both", "admin"] },
];

function SignedInTopbar({
  user,
  scrolled,
}: {
  user: SessionUser;
  scrolled: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className={`app-topbar ${scrolled ? "scrolled" : ""}`}>
      <div className="app-topbar-row">
        <Link href="/dashboard" className="logo logo-sm">
          <span className="logo-mark" />
          <span>mettle</span>
        </Link>
        <nav className="app-nav">
          {SIGNED_IN_NAV.filter((i) => i.roles.includes(user.role)).map(
            (item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`app-nav-link ${active ? "active" : ""}`}
                >
                  {item.label}
                </Link>
              );
            }
          )}
        </nav>
        <div className="app-user">
          <span className="app-user-name">{user.displayName}</span>
          <span className="app-user-role">{user.role}</span>
          <form action="/auth/logout" method="POST">
            <button type="submit" className="app-signout">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
