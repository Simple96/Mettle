import type { ReactNode } from "react";
import Link from "next/link";
import { requireUser, getProfile } from "@/lib/auth";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

export const metadata = {
  title: "Dashboard — Mettle",
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireUser();
  const profile = await getProfile();

  const role = profile?.role ?? "operator";
  const displayName = profile?.display_name ?? profile?.email?.split("@")[0] ?? "";

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-row">
          <Link href="/" className="logo logo-sm">
            <span className="logo-mark" />
            <span>mettle</span>
          </Link>
          <DashboardNav role={role} />
          <div className="app-user">
            <span className="app-user-name">{displayName || "—"}</span>
            <span className="app-user-role">{role}</span>
            <form action="/auth/logout" method="POST">
              <button type="submit" className="app-signout">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="wrap">{children}</div>
      </main>
    </div>
  );
}
