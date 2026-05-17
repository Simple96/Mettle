import type { ReactNode } from "react";
import Link from "next/link";
import { Header } from "@/components/header";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="legal-main">
        <div className="wrap legal-wrap">{children}</div>
      </main>
      <footer className="site-footer">
        <div className="wrap row">
          <span>© 2026 Mettle Labs</span>
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
