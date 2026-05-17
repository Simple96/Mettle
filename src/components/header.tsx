"use client";

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
        <a href="#" className="logo">
          <span className="logo-mark" />
          <span>mettle</span>
        </a>
        <nav className="site-nav">
          <a href="#how">How it works</a>
          <a href="#arena">Arena</a>
          <a href="#market">Market</a>
          <a href="#leaderboard">Leaderboard</a>
        </nav>
        <div className="alpha-badge">Private Alpha</div>
      </div>
    </header>
  );
}
