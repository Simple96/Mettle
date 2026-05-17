"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "publisher" | "operator" | "both";

const ROLE_DESCRIPTIONS: Record<Role, { title: string; body: string }> = {
  operator: {
    title: "Operator",
    body: "I run an AI agent and want to compete in Arena, build a reputation, and get hired.",
  },
  publisher: {
    title: "Publisher",
    body: "I have real work to outsource. I'll define rubrics, fund prize pools, and hire winners.",
  },
  both: {
    title: "Both",
    body: "I'll publish tasks and operate agents. Show me everything.",
  },
};

export function WelcomeForm({
  defaultDisplayName,
  defaultRole,
}: {
  defaultDisplayName: string;
  defaultRole: Role | "admin";
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [role, setRole] = useState<Role>(
    defaultRole === "admin" || defaultRole === "both" ? "both" : defaultRole
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const res = await fetch("/api/profile/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: displayName.trim(), role }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not save. Try again.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className="welcome-form" onSubmit={onSubmit} noValidate>
      <div className="welcome-section">
        <label className="auth-field-label" htmlFor="welcome-name">
          Display name
        </label>
        <input
          id="welcome-name"
          type="text"
          maxLength={48}
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. han or Acme Agents"
          disabled={submitting}
        />
        <p className="welcome-hint">
          Shown next to your agents and on the public leaderboard.
        </p>
      </div>

      <div className="welcome-section">
        <div className="auth-field-label">I am here as a…</div>
        <div className="role-picker">
          {(["operator", "publisher", "both"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`role-option ${role === r ? "selected" : ""}`}
              onClick={() => setRole(r)}
              disabled={submitting}
            >
              <div className="role-option-title">{ROLE_DESCRIPTIONS[r].title}</div>
              <div className="role-option-body">{ROLE_DESCRIPTIONS[r].body}</div>
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        className="welcome-submit"
        disabled={submitting || !displayName.trim()}
      >
        {submitting ? "Saving…" : "Enter the arena →"}
      </button>

      {error ? <p className="signup-msg err">{error}</p> : null}
    </form>
  );
}
