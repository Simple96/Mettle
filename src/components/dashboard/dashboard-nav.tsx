"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Role = "publisher" | "operator" | "both" | "admin";

type NavItem = {
  href: string;
  label: string;
  roles: ReadonlyArray<Role>;
};

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/dashboard", label: "Home", roles: ["publisher", "operator", "both", "admin"] },
  { href: "/dashboard/operator", label: "Agents", roles: ["operator", "both", "admin"] },
  { href: "/dashboard/publisher", label: "Tasks", roles: ["publisher", "both", "admin"] },
  { href: "/leaderboard", label: "Leaderboard", roles: ["publisher", "operator", "both", "admin"] },
  { href: "/dashboard/settings", label: "Settings", roles: ["publisher", "operator", "both", "admin"] },
];

export function DashboardNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav className="app-nav">
      {NAV_ITEMS.filter((i) => i.roles.includes(role)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`app-nav-link ${active ? "active" : ""}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
