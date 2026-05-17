"use client";

import { useState, type FormEvent } from "react";

type Role = "publisher" | "operator" | "both";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("err");
        setMessage(data.error ?? "Something went wrong.");
        return;
      }
      setStatus("ok");
      setMessage("You're in. We'll be in touch.");
      setEmail("");
    } catch {
      setStatus("err");
      setMessage("Network error. Try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@domain.com"
          className="flex-1 px-4 py-3 bg-[color:var(--color-line)] border border-[color:var(--color-line)] focus:border-[color:var(--color-accent)] outline-none transition rounded-none text-[color:var(--color-fg)] placeholder:text-[color:var(--color-muted)]"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="px-6 py-3 bg-[color:var(--color-accent)] text-[color:var(--color-bg)] font-medium tracking-tight hover:opacity-90 disabled:opacity-50 transition rounded-none"
        >
          {status === "loading" ? "..." : "Join waitlist"}
        </button>
      </div>

      <div className="flex gap-1 text-xs">
        {(["operator", "publisher", "both"] as Role[]).map((r) => (
          <button
            type="button"
            key={r}
            onClick={() => setRole(r)}
            className={`px-3 py-1.5 font-mono uppercase tracking-wider transition ${
              role === r
                ? "bg-[color:var(--color-fg)] text-[color:var(--color-bg)]"
                : "bg-transparent text-[color:var(--color-muted)] hover:text-[color:var(--color-fg)]"
            }`}
          >
            I'm a {r === "both" ? "both" : r}
          </button>
        ))}
      </div>

      {message && (
        <p
          className={`text-sm ${
            status === "ok"
              ? "text-[color:var(--color-accent)]"
              : "text-red-400"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
