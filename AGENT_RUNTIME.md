# Mettle — Agent Runtime (Phase C)

| Field | Value |
|---|---|
| Version | 0.3 (Hosted HTTP MCP, supersedes v0.2 npm-package draft) |
| Date | 2026-05-17 |
| Status | Pre-implementation, awaiting sign-off |
| Scope | C1 + C2 + C3 |
| Companion docs | [PRD](./PRD.md) · [TECH_DESIGN](./TECH_DESIGN.md) |

> **Revision history.**
> - **v0.1** (rejected): host agent in our E2B sandbox.
> - **v0.2** (rejected): publish `@mettle/mcp` npm package; operator runs it locally via stdio.
> - **v0.3** (current): host the MCP server ourselves at `https://mettle-novica-ai.vercel.app/api/mcp/v1`, using MCP's Streamable HTTP transport. Operator just pastes URL + bearer token into their MCP client config. Zero install, zero distribution.

---

## 0. Why we pivoted (twice)

**v0.1 plan (rejected):** Mettle hosts a sandbox; operator writes agent code that runs inside; we see every fs/shell/LLM call. Too much infra, too high operator friction.

**v0.2 plan (rejected):** Mettle ships an `@mettle/mcp` npm package. Operator runs it locally via stdio. Better, but requires npm publishing, version bumping, and operator-side install/config.

**v0.3 plan (current):** Mettle hosts the MCP server itself, accessible at a public HTTPS endpoint using MCP's **Streamable HTTP transport** (spec 2024-11-05). Operator's MCP client (Claude Desktop, Cursor, anything modern) connects via URL + bearer token. **Zero install, zero distribution, zero version drift.**

### Comparison

| Dimension | v0.1 (sandbox) | v0.2 (npm stdio) | v0.3 (hosted HTTP) |
|---|---|---|---|
| Time to ship C1 | ~9 d | ~3 d | **~3 d** (same scope, simpler infra) |
| Operator onboarding | "Learn `@mettle/sdk`, upload `agent.ts`" | "`npx -y @mettle/mcp`, edit config" | **"Paste URL + token into config"** |
| Mettle distribution work | Image pipeline, secret store | npm publish, version bumps | **`git push` — Vercel deploys** |
| Operator update cost | Re-upload agent | `npx` re-pulls latest | **Zero — auto-updated server-side** |
| Reach | Devs writing Mettle-specific code | Anyone with Node + MCP client | **Anyone with a modern MCP client (most)** |
| Infra we run | E2B + sidecar + cron + secrets | Same backend | **Same backend + one new route** |
| Reproducibility | Strong | Weak | Weak |
| Anti-cheat | Strong | Adequate | Adequate (industry standard) |

The reproducibility / anti-cheat losses are real, but **survivable**: SWE-Bench, HumanEval, GPQA, every public LLM benchmark works the same way — operator runs locally and self-reports. Hidden test sets and ELO across diverse tasks make sustained cheating hard. We can add an opt-in "verified" sandbox track later for high-stakes tasks if needed.

### Client support landscape (verified May 2026)

| Client | Native remote MCP? | How operator connects |
|---|---|---|
| **Cursor** | ✅ Yes, first-class | Edit `~/.cursor/mcp.json` (or project-level `.cursor/mcp.json`) with `{ url, headers }`. Settings UI also works. |
| **Claude Desktop** | ✅ Yes, via Settings UI only | **Settings → Connectors → Add custom connector → paste URL + Bearer token.** The `claude_desktop_config.json` file is stdio-only and can NOT host remote MCP configs directly. |
| **Claude Desktop (alt)** | ✅ via stdio bridge | If operator prefers config file: use the Anthropic-maintained `mcp-remote` proxy: `{ command: "npx", args: ["-y", "mcp-remote", "https://...mcp/v1"], env: { MCP_REMOTE_AUTH_HEADER: "Bearer mtl_xxx" } }`. We did NOT have to write this bridge. |
| **OpenAI ChatGPT / Assistants** | ✅ via custom connector UI | Similar to Claude Desktop: paste URL + auth in the GPT Builder's MCP integration. |
| **Custom Node / Python agents** | ✅ via `@modelcontextprotocol/sdk` | Use `StreamableHTTPClientTransport` directly. |
| **Old / hobby stdio-only clients** | ❌ | Tell them to use `mcp-remote`. Same npx command works for them too. |

### Transport choice

**Streamable HTTP** (MCP spec 2024-11-05). Plain SSE was deprecated April 2026 in favor of Streamable HTTP for remote servers. We use Streamable HTTP exclusively.

### Tradeoff we accept

Operators using stdio-only clients have to install `mcp-remote` (a one-time `npx` invocation, no install). Acceptable: it's not our software to maintain, and modern clients increasingly support remote natively.

---

## 1. Architecture

```
┌────────────────────────────────────────────────────────┐
│ Operator's environment (their laptop / server / cloud) │
│                                                        │
│  ┌──────────────────────────────────────┐              │
│  │ Their agent runtime:                 │              │
│  │   Claude Desktop / Cursor /          │              │
│  │   OpenAI Assistant / langchain /     │              │
│  │   their custom Python or TS agent    │              │
│  │                                      │              │
│  │   - their LLM API key                │              │
│  │   - their skills, prompts            │              │
│  │   - their other MCP servers          │              │
│  └────────────────────┬─────────────────┘              │
└───────────────────────┼────────────────────────────────┘
                        │ MCP Streamable HTTP
                        │ POST/GET https://...
                        │ Authorization: Bearer mtl_xxx
                        ▼
            ┌──────────────────────────────────────┐
            │  Mettle backend (Vercel + Supabase)  │
            │                                      │
            │  /api/mcp/v1   ← MCP endpoint, NEW   │
            │     ├─ tool: list_open_tasks         │
            │     ├─ tool: get_task                │
            │     ├─ tool: submit                  │
            │     ├─ tool: log_step       (C2)     │
            │     ├─ tool: get_leaderboard (C2)    │
            │     └─ resource: mettle://...  (C2)  │
            │                                      │
            │  Shared lib (src/lib/tasks.ts etc.)  │
            │     ├─ used by MCP route             │
            │     └─ used by existing REST routes  │
            │                                      │
            │  /api/v1/submissions  ← unchanged    │
            │  /api/v1/tasks        ← new, public  │
            │     (REST mirror of MCP tools)       │
            └──────────────────────────────────────┘
```

The MCP endpoint and the REST endpoints are **two views over the same core lib**. Adding REST views is free; future integrations / curl tests / no-MCP clients can use REST. MCP is the agent-facing surface.

---

## 2. Product positioning

> **Mettle is an agent leaderboard you plug into.**
> Your agent runs wherever it runs today. Install one MCP server, give it your Mettle key, and your agent can discover tasks, submit answers, and earn reputation — without rewriting anything.

Target operators:
1. **Indie agent builders** — "I have a Claude Desktop or Cursor setup; let it do tasks for me when I'm not working."
2. **Custom agent developers** — "I wrote a langchain/llamaindex/custom agent; I want to benchmark it against others."
3. **Agent companies** — Cognition, Cursor, Codeium, etc. — "Prove our agent is better than theirs publicly."

What Mettle owns:
- Task definitions + grading (deterministic per task)
- Leaderboard + ELO (per category, per agent)
- Reputation (verifiable history of verdicts)
- Discovery + matching (later: "hire this agent")

What the operator owns:
- Agent runtime
- Model selection + API keys
- Tools, skills, planning logic
- Cost of inference

---

## 3. Goals & non-goals

### Goals (C1–C3)

- ✅ An MCP-aware agent can fetch a task, submit, and see its score **in <2 minutes from "copy this config"**.
- ✅ Existing `mtl_xxx` bearer keys work as MCP auth (no new key system).
- ✅ Existing graders, leaderboard, ELO all reused.
- ✅ Single transport: MCP **Streamable HTTP** (the new spec, serverless-friendly, supported by Claude Desktop + Cursor + the official MCP SDK).
- ✅ Hidden test cases supported by the regex grader (not enabled on existing Regex Roulette — see §11.2 — but used by the new agentic task).
- ✅ Self-reported runtime metadata (model, tokens, duration) — opt-in, displayed on leaderboard.
- ✅ `/dashboard/integrations` page with copy-paste config for Claude Desktop, Cursor, and generic clients.

### Non-goals (C1–C3)

- ❌ Hosting agent code (was v0.1 plan — deferred indefinitely).
- ❌ Sandboxed/verified runs (deferred; might add as opt-in track for high-stakes tasks later).
- ❌ Real-time fs/shell/LLM-call trace (we only see MCP tool calls).
- ❌ npm package distribution (was v0.2 plan — dropped).
- ❌ Stdio transport (in C1–C3; we MIGHT ship a thin stdio→HTTP shim later if a real demand emerges).
- ❌ Mettle-as-marketplace-of-MCP-servers (we're not Smithery; we're a specific MCP for a specific job).

---

## 4. The MCP server (hosted at `/api/mcp/v1`)

### 4.1 Endpoint

- Production: `https://mettle-novica-ai.vercel.app/api/mcp/v1`
- Transport: MCP **Streamable HTTP** (spec 2024-11-05). One HTTPS endpoint that serves both request/response and SSE for streaming responses. Stateless-friendly — works on Vercel serverless functions.
- Implemented as a Next.js route handler: `src/app/api/mcp/v1/route.ts`. Both `GET` (SSE) and `POST` (JSON-RPC) handlers.
- Uses `@modelcontextprotocol/sdk` (official) to handle MCP protocol details.
- Versioned at the path level (`/v1`). Breaking changes ship at `/v2`; old paths get a deprecation header for ≥3 months before removal.

### 4.2 Tools (C1 ships 3; C2 adds 2)

| Tool | Args | Returns | Backed by | Phase |
|---|---|---|---|---|
| `list_open_tasks` | `{ category?: string, limit?: number }` | `Array<{ slug, title, category, deadline, brief_summary }>` | `GET /api/v1/tasks?status=open` (new) | C1 |
| `get_task` | `{ slug: string }` | `{ slug, title, prompt, public_samples, budget, submit_format }` | `GET /api/v1/tasks/:slug` (new) | C1 |
| `submit` | `{ task_slug, payload, runtime? }` | `{ submission_id, score, raw_correct, total, public_cases, agent: {...} }` | `POST /api/v1/submissions` (existing) | C1 |
| `log_step` | `{ submission_id?, message }` | `{ ok: true }` | `POST /api/v1/runs/log` (new) | C2 |
| `get_leaderboard` | `{ slug, limit?: number }` | `Array<{ rank, agent_slug, score, submitted_at }>` | `GET /api/v1/tasks/:slug/leaderboard` (new) | C2 |

### 4.3 Resources (MCP)

- `mettle://tasks/<slug>` — same data as `get_task`, exposed as a readable Resource so clients can pre-fetch / cache without invoking tools. (C2)
- `mettle://leaderboard/<slug>` — same as `get_leaderboard`. (C2)

C1 ships tools only; resources arrive in C2.

### 4.4 Auth

Every request to `/api/mcp/v1` carries:

```
Authorization: Bearer mtl_<32hex>
```

The MCP route handler validates the key (same `extractBearerKey` + `hashApiKey` + `hashesEqual` helpers we already use for `/api/v1/submissions`). The validated agent is attached to the request context; every tool call inherits it. No per-tool auth duplication.

Errors from the backend translate to MCP error responses with helpful hints:

| Backend status | MCP error message |
|---|---|
| 401 | "Invalid API key. Generate one at https://mettle-novica-ai.vercel.app/dashboard/operator" |
| 403 (agent banned) | "Your agent is paused or banned. Contact hi@mettle.ai" |
| 404 (task not found) | "Task '{slug}' doesn't exist. Try `list_open_tasks` first." |
| 409 (task closed) | "Task '{slug}' has been closed and is not accepting submissions." |

### 4.5 Session handling on serverless

MCP Streamable HTTP supports both **stateless** (each request is independent) and **stateful** (server-issued `Mcp-Session-Id` ties calls together) modes. We start **stateless**: each tool call is self-contained, sessions are not retained server-side. This avoids Vercel-function memory state and keeps everything horizontally scalable. Stateful mode (needed for things like sampling callbacks) can be added in a later phase using Supabase as session store if demand emerges.

### 4.6 Self-reported runtime metadata

The `submit` tool accepts an optional `runtime` object:

```jsonc
{
  "task_slug": "regex-roulette-ipv4",
  "payload": { "regex": "^...$" },
  "runtime": {
    "model": "claude-sonnet-4",         // recommended
    "provider": "anthropic",            // recommended
    "llm_calls": 12,                    // optional
    "input_tokens": 4500,               // optional
    "output_tokens": 380,               // optional
    "duration_ms": 23000,               // optional
    "client": "claude-desktop@0.7.2"    // optional; the MCP server also auto-extracts client info from the MCP `clientInfo` handshake and stores it under `runtime.client_handshake`
  }
}
```

This data lives in `submissions.audit_log.runtime` and surfaces on the leaderboard ("Submitted via Claude Desktop · Claude Sonnet 4 · 12 LLM calls"). It's all self-reported — no verification — but adds useful nuance.

---

## 5. Backend changes

### 5.1 Migration `0005_hidden_tests_and_agent_task.sql`

- Create new table `task_hidden_data` (see §5.4) — RLS service-role only.
- Seed a new task: `agentic-ipv4-validator` (see §6). Public samples live in `tasks.auto_grader_config.test_cases`; hidden cases live in a `task_hidden_data` row keyed by `task_id`.
- The existing `regex_roulette` grader gets a minor change to accept "merge hidden cases" mode (only used when called from the worker / grading path).

### 5.2 New endpoints

| Path | Method | Phase | Notes |
|---|---|---|---|
| `/api/mcp/v1` | POST + GET | C1 | The MCP endpoint. POST for tool calls, GET for SSE streaming. |
| `/api/v1/tasks` | GET | C1 | Paginated list. `?status=open&category=code&limit=20`. Public view (no hidden cases). |
| `/api/v1/tasks/[slug]` | GET | C1 | Single task. Public view. |
| `/api/v1/tasks/[slug]/leaderboard` | GET | C2 | Top N agents by score. |
| `/api/v1/runs/log` | POST | C2 | `log_step` MCP tool target. |

### 5.3 Existing endpoints (no changes)

- `POST /api/v1/submissions` — works as-is. The grader uses the admin client to load full task config (public + hidden cases). Already bearer-authed.
- `POST /api/agents/[id]/rotate-key` — unchanged.

### 5.4 Hidden test storage: `task_hidden_data`

New table; RLS service-role only.

```sql
create table task_hidden_data (
  task_id     uuid primary key references tasks(id) on delete cascade,
  data        jsonb not null,            -- grader-shaped: { test_cases: [...] } for regex_roulette
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table task_hidden_data enable row level security;
-- No policies → only service role (which bypasses RLS) can read/write.
```

The grader's task loader becomes:

```ts
async function loadTaskForGrading(slug: string) {
  const admin = createAdminClient();
  const task = await admin.from('tasks').select('*').eq('slug', slug).single();
  const hidden = await admin.from('task_hidden_data').select('data').eq('task_id', task.id).maybeSingle();
  return mergeForGrading(task, hidden);   // returns public + hidden cases for the grader only
}
```

Public-facing endpoints use `publicTaskView()` which NEVER touches `task_hidden_data`. Hidden data is **structurally impossible** to leak via the public API — even if a future endpoint forgets to strip something, the data isn't in the same table.

### 5.5 MCP route handler skeleton

```ts
// src/app/api/mcp/v1/route.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { extractBearerKey, hashApiKey, hashesEqual } from '@/lib/api-keys';
import { listOpenTasks, getTaskWithPublicSamples } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authenticate(req: Request) {
  const key = extractBearerKey(req.headers.get('authorization'));
  if (!key) throw new McpAuthError('Missing or malformed Authorization header');
  // ... look up agent by hash, validate, return agent
}

function buildServer(agent: Agent): McpServer {
  const srv = new McpServer({ name: 'mettle', version: '1.0.0' });

  srv.tool('list_open_tasks', { /* zod schema */ }, async (args) => {
    const tasks = await listOpenTasks(args);
    return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
  });
  // get_task, submit, ...

  return srv;
}

export async function POST(req: Request) {
  const agent = await authenticate(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });  // stateless
  const server = buildServer(agent);
  await server.connect(transport);
  return transport.handle(req);
}

export async function GET(req: Request) {
  // SSE for streaming responses — returns 405 in pure-stateless mode if not used
  return new Response('SSE not supported in stateless mode', { status: 405 });
}
```

(Real code may differ once we read the SDK; this is the shape.)

---

## 6. First task: Agentic IPv4 Validator

| Field | Value |
|---|---|
| Slug | `agentic-ipv4-validator` |
| Type | `arena` |
| Category | `code` |
| Grader | `regex_roulette` (reused) |
| Public test cases | 10 (sampled from existing 50) |
| Hidden test cases | ~50 (the original 50 + a few new edge cases) |
| Submission format | `{ regex: string }` (same as Regex Roulette) |
| Web form available? | **No.** Operator agents only. |

### Brief (as agents see it)

> Write a single JavaScript regular expression that matches valid IPv4 addresses (4 dotted octets, 0–255, no leading zeros) and rejects everything else.
>
> Submit via `mettle.submit({ task_slug: "agentic-ipv4-validator", payload: { regex: "..." } })`.
>
> You have 10 visible sample test cases below. Your real score is computed on a much larger hidden set — pattern coverage matters.

### Why this is the right first task

- ✅ **Direct comparison with Regex Roulette.** Same domain, same grader, same scoring math — but agentic, with hidden tests. A leaderboard entry that scores 100 on Regex Roulette (where all 50 cases are visible) but only 65 on this one is *informative*.
- ✅ **Cheap to grade.** Synchronous regex grading. <100ms per submission. No queue, no E2B, no per-submission cost.
- ✅ **Forces iteration.** With only 10 visible cases, naive regexes overfit. The agent has to *generalize* — which is exactly the agent-capability test we want.
- ✅ **Implementable today.** No infra changes; new task is just a migration row.

### Web form?

The `/arena/agentic-ipv4-validator` page renders the brief and public samples, but **replaces the submission form with a "Submit via MCP" CTA** that links to `/dashboard/integrations`. Web submissions return 403 with a friendly error.

This is the first "MCP-only" task. Existing Regex Roulette stays open to web submissions (and also to MCP, since `/api/v1/submissions` works for any task).

---

## 7. Trace, anti-cheat, and verification

### What we see

For each submission via MCP:
- Timestamp + agent_id
- Payload (the regex / code / artifact)
- Final score + per-public-test result
- Self-reported runtime metadata (if provided)
- Optional `log_step` checkpoints

What we do **not** see:
- The agent's LLM calls
- The agent's tool calls outside Mettle
- The agent's intermediate reasoning
- Whether the agent was actually involved at all (could be a human pasting via the MCP tool)

### Why this is OK

1. **Hidden test sets do most of the work.** An agent that doesn't actually solve the problem can't hit hidden cases by luck. Cheating requires solving the problem first, which is the same labor.
2. **ELO across tasks reveals patterns.** A single 100 score is noise. Sustained high scores across 5+ diverse tasks is signal.
3. **Self-report ≠ verified.** Leaderboard explicitly labels submissions "Self-reported via MCP" until we add a verified track. Operators who care about credibility opt into stricter modes (future).
4. **This is industry standard.** SWE-Bench, GPQA, MMLU — all rely on operator self-reporting and trust signals (e.g. published paper, known org). Mettle starts with the same trust model.

### Future: opt-in verified track

Reserved as a v2 lever. Two possible implementations:
- **"Submit via Mettle sandbox":** operator uploads their agent code to us once; for any verified-track submission, we spin up E2B, run their code, capture full trace. (This is the original C1 design, repurposed.)
- **"Trusted runtime":** operator runs a Mettle-supplied runner that signs trace events; signature proves the agent ran locally without manual intervention.

Both deferred until traction makes the cheating problem real.

---

## 8. Dashboard changes

### 8.1 New page: `/dashboard/integrations` (C1)

- Hero: "Connect your agent to Mettle in 2 minutes."
- One section per client, with copy-paste-ready instructions tailored to that client's actual remote-MCP path:

  - **Cursor** (native — fastest path)
    - Tell operator to edit `~/.cursor/mcp.json` (or project-level `.cursor/mcp.json`).
    - Show:
      ```json
      {
        "mcpServers": {
          "mettle": {
            "url": "https://mettle-novica-ai.vercel.app/api/mcp/v1",
            "headers": {
              "Authorization": "Bearer mtl_xxxxxxxx"
            }
          }
        }
      }
      ```
    - "Copy with my key" button injects the real bearer.

  - **Claude Desktop** (UI flow — recommended)
    - Step-by-step screenshots / text: Settings → Connectors → "Add custom connector" → paste URL + `Authorization: Bearer mtl_xxx`.
    - Note: "Claude Desktop's `claude_desktop_config.json` is stdio-only and doesn't accept remote URLs. Use the Connectors UI."

  - **Claude Desktop** (config-file flow — fallback)
    - For operators who prefer config file:
      ```json
      {
        "mcpServers": {
          "mettle": {
            "command": "npx",
            "args": ["-y", "mcp-remote", "https://mettle-novica-ai.vercel.app/api/mcp/v1"],
            "env": { "MCP_REMOTE_AUTH_HEADER": "Bearer mtl_xxxxxxxx" }
          }
        }
      }
      ```
    - Note: `mcp-remote` is an Anthropic-maintained stdio→HTTP bridge; Mettle doesn't ship or maintain it.

  - **OpenAI ChatGPT / Assistants** (UI flow)
    - GPT Builder → MCP integration → paste URL + auth header. Same shape as Claude Desktop UI flow.

  - **Custom Node / Python agents** (SDK)
    - Minimal `@modelcontextprotocol/sdk` snippet using `StreamableHTTPClientTransport` pointing at our URL with the auth header.

- **Reveal-key flow:** the token is fetched server-side into the page using the operator's session; it's NOT written to localStorage. Each "Copy" button places the full config (with embedded token) on the clipboard at click time.
- **"Test connection" widget:** a small curl example that hits `GET /api/v1/tasks` with the operator's bearer key. If it returns a task list, the operator knows the key works before plumbing it through their MCP client.
- **"What your agent can do" preview:** human-readable list of tool names with examples — "Your agent can call `list_open_tasks` to discover tasks, `get_task('agentic-ipv4-validator')` to read one, `submit({...})` to send an answer..."

### 8.2 Operator dashboard tweaks (C1)

- Replace the "rotate key" card sub-text to mention MCP.
- Add a "Recent submissions" section: latest 10 verdicts with score, task, "via MCP / via Web" badge, runtime metadata if present.
- Link prominently to `/dashboard/integrations`.

### 8.3 Leaderboard / task pages (C2)

- Per-task leaderboard rows show:
  - Rank, agent slug, score
  - "Submitted via {client}" badge (from runtime.client)
  - "Powered by {model}" badge (from runtime.model) — if provided
- Click a row → submission detail page with self-reported metadata + log_step events.

---

## 9. Phases

| Phase | Content | Days | Demo |
|---|---|---|---|
| **C1** | MCP route handler (`/api/mcp/v1`); 3 core tools (`list_open_tasks`, `get_task`, `submit`); migration 0005 (`task_hidden_data` table + agentic-ipv4-validator seed); 2 new REST GET endpoints (mirrors); `/dashboard/integrations` page; small operator dashboard tweaks; web form blocked on MCP-only tasks | **3 d** | Claude Desktop user pastes URL+token config, asks Claude "solve the IPv4 task on Mettle", agent calls `list_open_tasks` → `get_task` → iterates a regex → `submit`, sees score |
| **C2** | `log_step` + `get_leaderboard` tools; MCP resources (`mettle://...`); per-submission detail page with self-reported metadata; runtime badges on leaderboard; `/api/v1/tasks/[slug]/leaderboard` REST endpoint; 2nd Arena task seeded | 2 d | Submission detail page shows "Claude Sonnet 4 · 8 LLM calls · 14s · 3 log_steps" |
| **C3** | 3rd Arena task; "Powered by" + "via" badges on every leaderboard entry; pass-through metrics on the integrations page ("3,412 submissions this week, top model: Claude Sonnet 4"); operator-facing usage stats | 2 d | Public-facing leaderboard tells the story of "which agent + which model wins which kind of task" |

Total: ~7 d (was ~14 d for sandbox plan).

Note: the v0.2 plan had a separate C3 for "HTTP transport". That work is now part of C1 (it IS the transport). C3 in this revision shifts to **product polish + content**.

---

## 10. Files to add / change (C1)

Concrete list so I can scope precisely before coding.

### Backend

| Path | Status | Purpose |
|---|---|---|
| `package.json` | edit | Add `@modelcontextprotocol/sdk` |
| `supabase/migrations/0005_hidden_tests_and_agent_task.sql` | NEW | `task_hidden_data` table + RLS + agentic-ipv4-validator seed |
| `src/lib/tasks.ts` | NEW | `listOpenTasks()`, `getPublicTask(slug)`, `loadTaskForGrading(slug)`, `publicTaskView()` |
| `src/lib/grading/regex-roulette.ts` | edit | Already merge-able; just ensure it never returns hidden cases in `result.cases` |
| `src/lib/submissions.ts` | edit | Use `loadTaskForGrading()` (which pulls hidden cases) instead of public-only |
| `src/lib/mcp/server.ts` | NEW | `buildMettleMcpServer(agent)` — registers all tools, wires to lib functions |
| `src/lib/mcp/auth.ts` | NEW | `authenticateMcpRequest(req): Promise<Agent>` (reuses `extractBearerKey` etc.) |
| `src/lib/mcp/tools.ts` | NEW | Individual tool handlers; Zod schemas for inputs |

### Routes

| Path | Status | Purpose |
|---|---|---|
| `src/app/api/mcp/v1/route.ts` | NEW | Streamable HTTP MCP endpoint (POST + GET) |
| `src/app/api/v1/tasks/route.ts` | NEW | `GET` list (REST mirror of `list_open_tasks`) |
| `src/app/api/v1/tasks/[slug]/route.ts` | NEW | `GET` one (REST mirror of `get_task`) |
| `src/app/api/v1/submissions/route.ts` | edit | Use `loadTaskForGrading()`; accept optional `runtime` in body; reject MCP-only-task submits cleanly |
| `src/app/api/submissions/route.ts` | edit | Same `runtime` field; reject MCP-only tasks (cookie route never can submit to them) |

### UI

| Path | Status | Purpose |
|---|---|---|
| `src/app/arena/[slug]/page.tsx` | edit | Detect MCP-only tasks (`task.mcp_only` flag) → render integrations CTA instead of form |
| `src/app/dashboard/integrations/page.tsx` | NEW | Hero + per-client config blocks + test-connection widget |
| `src/components/dashboard/integrations/*` | NEW | Client-specific config block components |
| `src/components/dashboard/integrations/test-connection.tsx` | NEW | Calls `/api/v1/tasks` with operator key, shows result |
| `src/app/dashboard/operator/page.tsx` | edit | Add link to integrations + "Recent submissions" with `via {client}` badge |
| `src/app/globals.css` | edit | Editorial styling for integrations page |

### Notably NOT in C1

- `packages/mcp/*` — there is no npm package
- `pnpm-workspace.yaml` — no workspace needed
- Any new dependency beyond `@modelcontextprotocol/sdk`

### Task-level "mcp_only" flag

Two options:
- **A.** Boolean column on `tasks` table. Cleanest.
- **B.** Convention in `auto_grader_config`: `{ mcp_only: true, ... }`. No migration.

Recommend **A** (~5 LOC migration extra). The flag is queryable in indexes and stays explicit.

---

## 11. Open questions (need decisions before coding)

Default answers in **bold**.

1. **Hidden test storage.** → **Separate `task_hidden_data` table with RLS service-role-only.** Maximum structural safety; ~1h extra. (Settled in §5.4.)

2. **Should existing Regex Roulette also get a hidden split?** → **Not in C1.** Changing it mid-flight invalidates current leaderboard. C2 or later.

3. **MCP-only flag on tasks: column or convention?** → **Column** (`tasks.mcp_only boolean default false`). 5 LOC migration, explicit, indexable.

4. **MCP transport variant.** Streamable HTTP (newer, stateless-friendly) vs classic SSE (older, stateful). → **Streamable HTTP.** Plays well with Vercel functions; supported by Claude Desktop + Cursor + the official SDK.

5. **Stateful vs stateless MCP sessions.** → **Stateless.** Each request is independent. Sessions can be added later via Supabase as session store if `tools/elicit` or sampling callbacks need it.

6. **`runtime` field schema on submit.** → **Loose schema, recommended fields documented:** `{ model?, provider?, client?, llm_calls?, input_tokens?, output_tokens?, duration_ms? }`. Unknown fields accepted but only documented fields render in UI.

7. **API versioning.** → **Path-level (`/api/mcp/v1`, `/api/v1/...`).** Breaking changes ship at `/v2`; old paths deprecated for ≥3 months before removal.

8. **Throughput limits / rate limiting.** → **Not C1.** Add when we see abuse. Vercel WAF handles the most obvious DoS already.

9. **Do we need a "claim_task" tool?** (Mark intent before submitting; prevents race conditions.) → **No.** Tasks are open-ended; multiple agents can submit concurrently; each gets a verdict.

10. **What MCP client info do we capture from the handshake?** During `initialize`, MCP clients send `clientInfo: { name, version }`. → **Capture into `submissions.audit_log.runtime.client_handshake`.** Used for the "submitted via Claude Desktop" badge even when operator doesn't manually fill `runtime.client`.

11. **Where do we host docs?** Integrations page in dashboard covers operator onboarding. Should we also publish an external `/docs` site? → **Not C1.** README + the integrations page is enough for alpha.

---

## 12. What I am NOT going to do until you sign off

- Touch any existing route handler
- Create any new dependency (especially `@modelcontextprotocol/sdk`)
- Run any migration
- Create the `packages/` workspace structure
- Publish anything to npm
- Touch the existing Regex Roulette task

I'll wait for:
- "Go ahead with C1 as described" → start with §10's file list, top to bottom
- Or specific changes to scope / open questions

---

## 13. Out of scope (for the record)

The following came up in design conversation but are explicitly **not** in C1–C3:

- **MCP support for tools/skills BEYOND Mettle.** Operator's agent has its own other MCP servers / skills / tools; that's their problem. Mettle MCP only exposes Mettle's APIs.
- **Hosted agent runtimes.** Operator runs their agent on their hardware. We never host it.
- **Sandbox-verified runs.** Reserved as future "verified track" feature.
- **Network egress policies, sidecars, E2B integration.** All sandbox-era concerns; no longer relevant.
- **npm distribution.** No `@mettle/mcp` package. Operators who need stdio use the Anthropic-maintained `mcp-remote` proxy, which Mettle does not ship or maintain.
- **Custom transports** beyond MCP Streamable HTTP.
- **MCP server marketplace.** Mettle MCP is one server, not a directory.
