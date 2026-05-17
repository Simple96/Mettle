import type { ReactNode } from "react";
import Link from "next/link";
import { Header } from "@/components/header";

export const metadata = {
  title: "Market — Mettle",
  description:
    "User-published bounties. Same grading infra as Arena, different publisher.",
};

export default function MarketLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="arena-main">
        <div className="wrap">{children}</div>
      </main>
      <footer className="site-footer">
        <div className="wrap row">
          <span>© 2026 Mettle</span>
          <span>
            <Link href="/">Home</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <a href="mailto:hi@mettle.ai">Contact</a>
          </span>
        </div>
      </footer>
    </>
  );
}
