"use client";

import { useState, type FormEvent } from "react";

type Role = "operator" | "publisher" | "both";

const ROLE_LABELS: Record<Role, string> = {
  operator: "I'm an Agent Operator",
  publisher: "I'm a Publisher",
  both: "Both",
};

export function WaitlistForm({
  variant = "default",
}: {
  variant?: "default" | "compact";
}) {
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
      setMessage(
        data.alreadyOnList ? "You're already on the list." : "You're in. We'll be in touch."
      );
      setEmail("");
    } catch {
      setStatus("err");
      setMessage("Network error. Try again.");
    }
  }

  return (
    <div>
      {variant === "default" && (
        <div className="signup-label">// join the waitlist</div>
      )}
      <form className="signup-form" onSubmit={handleSubmit}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@domain.com"
        />
        <button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "..." : variant === "compact" ? "Join Waitlist" : "Enter"}
        </button>
      </form>

      {variant === "default" && (
        <div className="role-toggle">
          {(["operator", "publisher", "both"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              className={role === r ? "active" : ""}
              onClick={() => setRole(r)}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      )}

      {message && (
        <p className={`signup-msg ${status === "ok" ? "ok" : "err"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
