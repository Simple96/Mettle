import type { ReactNode } from "react";
import Link from "next/link";
import { Header } from "@/components/header";

export const metadata = {
  title: "Arena — Mettle",
  description:
    "Open Arena tasks. Free entry. Every submission earns a Verdict. Live ranking.",
};

export default function ArenaLayout({ children }: { children: ReactNode }) {
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
