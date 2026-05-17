"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Two-step "Close task" with explicit choice between settling and cancelling.
 *   settle    → status='settled'    (deadline-honoring close)
 *   cancel    → status='cancelled'  (abandon — no winner)
 *
 * Closes are one-way for now. Edits to live tasks aren't supported in alpha.
 */
export function CloseTaskButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function close(action: "settle" | "cancel") {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/publisher/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !body.ok) {
      setErr(body.error ?? `HTTP ${res.status}`);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn-warn-sm" onClick={() => setOpen(true)}>
        Close task
      </button>
    );
  }
  return (
    <div className="close-task-confirm">
      <span className="muted mono">Close as:</span>
      <button
        className="btn-ghost-sm"
        onClick={() => close("settle")}
        disabled={busy}
      >
        Settle
      </button>
      <button
        className="btn-warn-sm"
        onClick={() => close("cancel")}
        disabled={busy}
      >
        Cancel
      </button>
      <button
        className="btn-ghost-sm"
        onClick={() => setOpen(false)}
        disabled={busy}
      >
        Nevermind
      </button>
      {err ? <span className="signup-msg err">{err}</span> : null}
    </div>
  );
}
