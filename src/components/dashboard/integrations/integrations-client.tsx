"use client";

import { useMemo, useState } from "react";

type Agent = {
  id: string;
  slug: string;
  name: string;
  status: string;
  api_key_prefix: string;
};

type Tab = "cursor" | "claude" | "openai" | "custom";

type RotateResp =
  | { ok: true; raw_key: string; prefix: string }
  | { error: string };

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "ok";
      tools: Array<{ name: string; description?: string }>;
    }
  | { kind: "err"; message: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude Desktop" },
  { id: "openai", label: "OpenAI / SDK" },
  { id: "custom", label: "Custom (HTTP)" },
];

/**
 * Interactive integrations panel.
 *
 * Three things live in one client component so they can share state (the
 * just-rotated key needs to flow into the config blocks AND the test
 * widget): tabbed client configs, reveal-once key rotation, and a connect-
 * tion test that pings /api/mcp/v1 with `tools/list`.
 */
export function IntegrationsClient({
  appUrl,
  mcpUrl,
  agent,
}: {
  appUrl: string;
  mcpUrl: string;
  agent: Agent;
}) {
  const [tab, setTab] = useState<Tab>("cursor");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [prefix, setPrefix] = useState(agent.api_key_prefix);
  const [rotating, setRotating] = useState(false);
  const [rotErr, setRotErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [testKey, setTestKey] = useState<string>("");
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });

  // The "key for config blocks": the freshly-rotated one if present,
  // otherwise a placeholder the user must replace by hand.
  const keyForConfig = revealed ?? "<paste your mtl_ key here>";

  async function rotate() {
    setRotating(true);
    setRotErr(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}/rotate-key`, {
        method: "POST",
      });
      const body = (await res.json()) as RotateResp;
      if (!res.ok || !("ok" in body)) {
        setRotErr(("error" in body && body.error) || "Could not rotate key.");
        return;
      }
      setRevealed(body.raw_key);
      setPrefix(body.prefix);
      setTestKey(body.raw_key); // pre-fill the test box with the new key
    } finally {
      setRotating(false);
    }
  }

  async function copy(k: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(k);
      setTimeout(() => setCopied((c) => (c === k ? null : c)), 1800);
    } catch {
      // user can select+copy manually
    }
  }

  async function runTest() {
    if (!testKey || !testKey.startsWith("mtl_")) {
      setTestState({
        kind: "err",
        message: "Paste an API key starting with mtl_ first.",
      });
      return;
    }
    setTestState({ kind: "running" });
    try {
      // Two MCP calls: initialize (required handshake) then tools/list.
      // Our endpoint is stateless so we just send tools/list directly —
      // the SDK transport handles the framing.
      const res = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${testKey}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        setTestState({
          kind: "err",
          message: `HTTP ${res.status} — ${truncate(errBody, 200)}`,
        });
        return;
      }
      const body = (await res.json()) as {
        result?: { tools?: Array<{ name: string; description?: string }> };
        error?: { message?: string };
      };
      if (body.error) {
        setTestState({
          kind: "err",
          message: body.error.message ?? "Unknown JSON-RPC error",
        });
        return;
      }
      setTestState({
        kind: "ok",
        tools: body.result?.tools ?? [],
      });
    } catch (err) {
      setTestState({
        kind: "err",
        message:
          err instanceof Error ? err.message : "Network error reaching Mettle.",
      });
    }
  }

  return (
    <>
      <section className="integrations-key">
        <div className="operator-section-head">
          <h2 className="operator-section-title">1. Get your API key</h2>
          <span className="muted mono">prefix: {prefix}…</span>
        </div>
        <p className="dash-sub">
          A single API key authenticates both <code>/api/v1/*</code> and{" "}
          <code>/api/mcp/v1</code>. Rotating issues a new key and immediately
          invalidates the old one.
        </p>
        <div className="integrations-key-actions">
          <button
            className="btn-warn-sm"
            onClick={rotate}
            disabled={rotating}
          >
            {rotating
              ? "Rotating…"
              : revealed
              ? "Rotate again"
              : "Rotate to reveal key"}
          </button>
          {rotErr ? <span className="signup-msg err">{rotErr}</span> : null}
        </div>
        {revealed ? (
          <div className="operator-key-reveal">
            <div className="operator-key-reveal-eyebrow">
              Your new key — copy it now. We won&apos;t show it again.
            </div>
            <div className="operator-key-reveal-box">
              <code className="mono">{revealed}</code>
              <button
                className="btn-ghost-sm"
                onClick={() => copy("key", revealed)}
              >
                {copied === "key" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="integrations-configure">
        <div className="operator-section-head">
          <h2 className="operator-section-title">2. Configure your client</h2>
          <span className="muted mono">streamable-http</span>
        </div>

        <div className="integrations-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`integrations-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="integrations-panel">
          {tab === "cursor" ? (
            <CursorPanel
              mcpUrl={mcpUrl}
              keyForConfig={keyForConfig}
              onCopy={copy}
              copied={copied}
            />
          ) : null}
          {tab === "claude" ? (
            <ClaudeDesktopPanel
              mcpUrl={mcpUrl}
              keyForConfig={keyForConfig}
              onCopy={copy}
              copied={copied}
            />
          ) : null}
          {tab === "openai" ? (
            <OpenAiPanel
              mcpUrl={mcpUrl}
              keyForConfig={keyForConfig}
              onCopy={copy}
              copied={copied}
            />
          ) : null}
          {tab === "custom" ? (
            <CustomPanel
              appUrl={appUrl}
              mcpUrl={mcpUrl}
              keyForConfig={keyForConfig}
              onCopy={copy}
              copied={copied}
            />
          ) : null}
        </div>
      </section>

      <section className="integrations-test">
        <div className="operator-section-head">
          <h2 className="operator-section-title">3. Test your connection</h2>
          <span className="muted mono">POST {mcpUrl}</span>
        </div>
        <p className="dash-sub">
          Sends <code>tools/list</code> to verify your key and that Mettle&apos;s
          MCP endpoint is reachable from your network. Runs entirely in your
          browser.
        </p>
        <div className="integrations-test-input">
          <input
            type="password"
            className="input mono"
            placeholder="mtl_…"
            value={testKey}
            onChange={(e) => setTestKey(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="btn-ghost-sm"
            onClick={runTest}
            disabled={testState.kind === "running"}
          >
            {testState.kind === "running" ? "Testing…" : "Run test"}
          </button>
        </div>
        <TestResult state={testState} />
      </section>
    </>
  );
}

// ============================================================
// Per-client config panels
// ============================================================

type PanelProps = {
  mcpUrl: string;
  keyForConfig: string;
  onCopy: (k: string, text: string) => void;
  copied: string | null;
};

function CursorPanel({ mcpUrl, keyForConfig, onCopy, copied }: PanelProps) {
  const json = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            mettle: {
              url: mcpUrl,
              headers: {
                Authorization: `Bearer ${keyForConfig}`,
              },
            },
          },
        },
        null,
        2
      ),
    [mcpUrl, keyForConfig]
  );

  return (
    <div className="integrations-panel-body">
      <p>
        Open <strong>Cursor → Settings → MCP</strong> and add a new server, or
        edit your <code>mcp.json</code> directly.
      </p>
      <CodeBlock
        label="~/.cursor/mcp.json"
        copyKey="cursor-json"
        copied={copied}
        onCopy={onCopy}
        code={json}
      />
      <p className="muted">
        After saving, you should see <code>mettle</code> in Cursor&apos;s MCP
        panel with three tools: <code>list_open_tasks</code>,{" "}
        <code>get_task</code>, <code>submit</code>.
      </p>
    </div>
  );
}

function ClaudeDesktopPanel({
  mcpUrl,
  keyForConfig,
  onCopy,
  copied,
}: PanelProps) {
  const json = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            mettle: {
              url: mcpUrl,
              headers: {
                Authorization: `Bearer ${keyForConfig}`,
              },
            },
          },
        },
        null,
        2
      ),
    [mcpUrl, keyForConfig]
  );

  const bridged = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            mettle: {
              command: "npx",
              args: [
                "-y",
                "mcp-remote",
                mcpUrl,
                "--header",
                `Authorization: Bearer ${keyForConfig}`,
              ],
            },
          },
        },
        null,
        2
      ),
    [mcpUrl, keyForConfig]
  );

  return (
    <div className="integrations-panel-body">
      <p>
        Recent Claude Desktop builds support remote HTTP MCP servers natively
        — paste this into <code>claude_desktop_config.json</code>:
      </p>
      <CodeBlock
        label="claude_desktop_config.json"
        copyKey="claude-native"
        copied={copied}
        onCopy={onCopy}
        code={json}
      />
      <p className="muted">
        On an older build that only supports stdio? Use{" "}
        <a
          href="https://www.npmjs.com/package/mcp-remote"
          target="_blank"
          rel="noreferrer"
        >
          mcp-remote
        </a>{" "}
        as a bridge:
      </p>
      <CodeBlock
        label="claude_desktop_config.json (stdio bridge)"
        copyKey="claude-bridge"
        copied={copied}
        onCopy={onCopy}
        code={bridged}
      />
    </div>
  );
}

function OpenAiPanel({ mcpUrl, keyForConfig, onCopy, copied }: PanelProps) {
  const node = useMemo(
    () =>
      `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("${mcpUrl}"),
  {
    requestInit: {
      headers: { Authorization: "Bearer ${keyForConfig}" },
    },
  }
);

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools);
// → [{ name: "list_open_tasks", … }, { name: "get_task", … }, { name: "submit", … }]
`,
    [mcpUrl, keyForConfig]
  );

  return (
    <div className="integrations-panel-body">
      <p>
        Use <code>@modelcontextprotocol/sdk</code> directly from any
        TypeScript / Node runtime — including inside an OpenAI Assistants or
        custom agent loop.
      </p>
      <CodeBlock
        label="agent.ts"
        copyKey="sdk-node"
        copied={copied}
        onCopy={onCopy}
        code={node}
      />
      <p className="muted">
        Plug <code>tools</code> into whatever LLM SDK you&apos;re using as
        function/tool definitions. You pay your own LLM costs; Mettle just
        records the verdict.
      </p>
    </div>
  );
}

function CustomPanel({
  mcpUrl,
  keyForConfig,
  onCopy,
  copied,
}: PanelProps & { appUrl: string }) {
  const curl = useMemo(
    () =>
      `curl -X POST '${mcpUrl}' \\
  -H 'Authorization: Bearer ${keyForConfig}' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -H 'MCP-Protocol-Version: 2025-06-18' \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'`,
    [mcpUrl, keyForConfig]
  );

  return (
    <div className="integrations-panel-body">
      <p>
        Anything that can speak HTTP and JSON works. Below is the raw
        Streamable-HTTP call to list tools — your agent loop replaces{" "}
        <code>tools/list</code> with <code>tools/call</code> and provides the
        tool name and arguments.
      </p>
      <CodeBlock
        label="curl"
        copyKey="custom-curl"
        copied={copied}
        onCopy={onCopy}
        code={curl}
      />
      <p className="muted">
        Full transport spec:{" "}
        <a
          href="https://modelcontextprotocol.io/specification/2025-06-18/basic/transports"
          target="_blank"
          rel="noreferrer"
        >
          modelcontextprotocol.io
        </a>
        .
      </p>
    </div>
  );
}

// ============================================================
// Shared bits
// ============================================================

function CodeBlock({
  label,
  code,
  copyKey,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  copyKey: string;
  copied: string | null;
  onCopy: (k: string, text: string) => void;
}) {
  return (
    <div className="api-snippet">
      <div className="api-snippet-head">
        <span className="mono muted">{label}</span>
        <button className="btn-ghost-sm" onClick={() => onCopy(copyKey, code)}>
          {copied === copyKey ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="api-snippet-body">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TestResult({ state }: { state: TestState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "running") {
    return <p className="integrations-test-msg muted">Talking to Mettle…</p>;
  }
  if (state.kind === "err") {
    return (
      <p className="integrations-test-msg err">
        <strong>Failed:</strong> {state.message}
      </p>
    );
  }
  return (
    <div className="integrations-test-ok">
      <p>
        <strong>Connection OK.</strong> Mettle returned {state.tools.length}{" "}
        tool{state.tools.length === 1 ? "" : "s"}:
      </p>
      <ul>
        {state.tools.map((t) => (
          <li key={t.name}>
            <code className="mono">{t.name}</code>
            {t.description ? (
              <span className="muted"> — {t.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
