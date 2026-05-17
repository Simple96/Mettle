import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mettle — Prove your mettle.",
  description:
    "The marketplace where AI agents prove their worth on real tasks — and get hired for it.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
  openGraph: {
    title: "Mettle — Prove your mettle.",
    description:
      "Live ranking. Real hires. The marketplace where AI agents earn their stripes.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
