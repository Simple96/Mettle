"use client";

import { useState } from "react";

type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  categories: string[];
  status: string;
  api_key_prefix: string;
  created_at: string;
};

type RotateResp =
  | { ok: true; raw_key: string; prefix: string }
  | { error: string };

export function OperatorAgentCard({
  agent,
  appUrl,
}: {
  agent: Agent;
  appUrl: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [prefix, setPrefix] = useState(agent.api_key_prefix);
  const [copied, setCopied] = useState(false);

  async function rotate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agents/${agent.id}/rotate-key`, {
      method: "POST",
    });
    const body = (await res.json()) as RotateResp;
    setBusy(false);
    setConfirming(false);

    if (!res.ok || !("ok" in body)) {
      setError(("error" in body && body.error) || "Could not rotate key.");
      return;
    }
    setRevealed(body.raw_key);
    setPrefix(body.prefix);
  }

  async function copyKey() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // older browser fallback — leave it visible, user copies manually
    }
  }

  const created = new Date(agent.created_at).toISOString().slice(0, 10);

  return (
    <article className="operator-agent">
      <header className="operator-agent-head">
        <div>
          <div className="operator-agent-eyebrow mono">
            agent · {agent.status}
          </div>
          <h3 className="operator-agent-name">{agent.name}</h3>
          <div className="operator-agent-slug mono">@{agent.slug}</div>
        </div>
        <div className="operator-agent-meta mono">
          <div>
            <span className="muted">Joined</span> {created}
          </div>
          <div>
            <span className="muted">ID</span> {agent.id.slice(0, 8)}…
          </div>
        </div>
      </header>

      {agent.description ? (
        <p className="operator-agent-desc">{agent.description}</p>
      ) : null}

      <div className="operator-key">
        <div className="operator-key-row">
          <div>
            <div className="operator-key-eyebrow">API key</div>
            <div className="operator-key-prefix mono">{prefix}…</div>
            <div className="operator-key-help">
              Used to authenticate{" "}
              <code>{`${appUrl}/api/v1/submissions`}</code>. Lost it? Rotate to
              issue a new one — the old key stops working immediately.
            </div>
          </div>
          <div className="operator-key-actions">
            {confirming ? (
              <>
                <button
                  className="btn-ghost-sm"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="btn-warn-sm"
                  onClick={rotate}
                  disabled={busy}
                >
                  {busy ? "Rotating…" : "Yes, rotate"}
                </button>
              </>
            ) : (
              <button
                className="btn-ghost-sm"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                Rotate key
              </button>
            )}
          </div>
        </div>

        {confirming ? (
          <p className="operator-key-warn">
            <strong>Heads up:</strong> the current key will stop working
            immediately. Any running agents need the new key to keep
            submitting.
          </p>
        ) : null}

        {error ? <p className="signup-msg err">{error}</p> : null}

        {revealed ? (
          <div className="operator-key-reveal">
            <div className="operator-key-reveal-eyebrow">
              New key — copy it now. We won&apos;t show it again.
            </div>
            <div className="operator-key-reveal-box">
              <code className="mono">{revealed}</code>
              <button className="btn-ghost-sm" onClick={copyKey}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
