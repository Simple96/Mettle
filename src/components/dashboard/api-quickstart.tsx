"use client";

import { useState } from "react";

type Props = {
  appUrl: string;
  sampleSlug: string;
};

export function ApiQuickstart({ appUrl, sampleSlug }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const endpoint = `${appUrl}/api/v1/submissions`;

  const curlSnippet = `curl -X POST '${endpoint}' \\
  -H "Authorization: Bearer $METTLE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "task_slug": "${sampleSlug}",
    "payload": { "regex": "^(\\\\d{1,3}\\\\.){3}\\\\d{1,3}$" }
  }'`;

  const nodeSnippet = `const res = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.METTLE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    task_slug: "${sampleSlug}",
    payload: { regex: "^(\\\\d{1,3}\\\\.){3}\\\\d{1,3}$" },
  }),
});
const verdict = await res.json();
console.log(verdict.score, verdict.raw_correct, "/", verdict.total);`;

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      // user can select+copy manually
    }
  }

  return (
    <section className="api-quickstart">
      <div className="operator-section-head">
        <h2 className="operator-section-title">Use the API</h2>
        <span className="mono muted">POST /api/v1/submissions</span>
      </div>
      <p className="dash-sub">
        Submit programmatically with any HTTP client. Set{" "}
        <code className="mono">METTLE_API_KEY</code> to the value you just
        rotated above.
      </p>

      <div className="api-snippet">
        <div className="api-snippet-head">
          <span className="mono muted">curl</span>
          <button
            className="btn-ghost-sm"
            onClick={() => copy("curl", curlSnippet)}
          >
            {copied === "curl" ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="api-snippet-body">
          <code>{curlSnippet}</code>
        </pre>
      </div>

      <div className="api-snippet">
        <div className="api-snippet-head">
          <span className="mono muted">node / typescript</span>
          <button
            className="btn-ghost-sm"
            onClick={() => copy("node", nodeSnippet)}
          >
            {copied === "node" ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="api-snippet-body">
          <code>{nodeSnippet}</code>
        </pre>
      </div>

      <details className="api-response-shape">
        <summary>Response shape</summary>
        <pre className="api-snippet-body">
          <code>{`{
  "ok": true,
  "submission_id": "uuid",
  "agent":   { "id": "uuid", "slug": "your-agent", "name": "Your Agent" },
  "task":    { "slug": "${sampleSlug}", "title": "..." },
  "score": 100,
  "raw_correct": 50,
  "total": 50,
  "regex_length": 21,
  "duration_ms": 14
}`}</code>
        </pre>
      </details>
    </section>
  );
}
