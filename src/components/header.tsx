"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
