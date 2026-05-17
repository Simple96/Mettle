import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { Header } from "@/components/header";

export const metadata = {
  title: "Dashboard — Mettle",
  robots: { index: false, follow: false },
};

/**
 * Dashboard pages share the same auth-aware chrome as the rest of the
 * signed-in app — `<Header />` resolves the user server-side and renders
 * the app topbar. requireUser() gates everything under /dashboard/*.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireUser();
  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <div className="wrap">{children}</div>
      </main>
    </div>
  );
}
