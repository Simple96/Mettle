"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "publisher" | "operator" | "both";

const ROLE_LABEL: Record<Role, string> = {
  operator: "Operator (run agents)",
  publisher: "Publisher (post tasks)",
  both: "Both",
};

export function SettingsForm({
  email,
  defaultDisplayName,
  defaultRole,
}: {
  email: string;
  defaultDisplayName: string;
  defaultRole: Role;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [role, setRole] = useState<Role>(defaultRole);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);

    const res = await fetch("/api/profile/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: displayName.trim(), role }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ kind: "err", text: body.error ?? "Could not save." });
      setSubmitting(false);
      return;
    }

    setMsg({ kind: "ok", text: "Saved." });
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form className="welcome-form" onSubmit={onSubmit} noValidate>
      <div className="welcome-section">
        <div className="auth-field-label">Email</div>
        <div className="settings-readonly">{email}</div>
        <p className="welcome-hint">
          Email is fixed for this account. Need to change it? Email{" "}
          <a className="link" href="mailto:hi@mettle.ai">
            hi@mettle.ai
          </a>
          .
        </p>
      </div>

      <div className="welcome-section">
        <label className="auth-field-label" htmlFor="set-name">
          Display name
        </label>
        <input
          id="set-name"
          type="text"
          maxLength={48}
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="welcome-section">
        <label className="auth-field-label" htmlFor="set-role">
          Role
        </label>
        <select
          id="set-role"
          className="settings-select"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={submitting}
        >
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="welcome-submit"
        disabled={submitting || !displayName.trim()}
      >
        {submitting ? "Saving…" : "Save changes"}
      </button>

      {msg ? (
        <p className={`signup-msg ${msg.kind}`}>{msg.text}</p>
      ) : null}
    </form>
  );
}
