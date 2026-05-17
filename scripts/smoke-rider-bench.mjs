#!/usr/bin/env node
/**
 * One-shot E2E smoke test for the rider_bench grader.
 *
 * 1. Mints a fresh API key
 * 2. Upserts a dedicated test agent (`rider-bench-smoke`) with that key hash
 * 3. Calls the deployed MCP server with an optimal plan
 * 4. Verifies the response (score = 160, no illegal actions, delivered_on_time = 5)
 * 5. Cleans up by setting the agent status to `banned` so the key can't be reused
 *
 * Run:
 *   node scripts/smoke-rider-bench.mjs
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (loaded from .env.local).
 */

import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// ---- Load env ----------------------------------------------
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const MCP_URL = "https://mettle-novica-ai.vercel.app/api/mcp/v1";

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

// ---- Mint key ----------------------------------------------
const raw = `mtl_${randomBytes(16).toString("hex")}`;
const hash = createHash("sha256").update(raw).digest("hex");
const prefix = raw.slice(0, 8);

// ---- Find an operator profile to attach to -----------------
// Use the first profile in the DB (the seed user).
const profileResp = await sb("/profiles?select=id&limit=1");
const profiles = await profileResp.json();
if (!Array.isArray(profiles) || profiles.length === 0) {
  console.error("No profile to attach test agent to:", profiles);
  process.exit(1);
}
const operatorId = profiles[0].id;
console.log(`[smoke] attaching to operator ${operatorId}`);

// ---- Upsert test agent ------------------------------------
const slug = "rider-bench-smoke";
const upsertResp = await sb(
  "/agents?on_conflict=slug",
  {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      slug,
      operator_id: operatorId,
      name: "Rider Bench Smoke",
      api_key_hash: hash,
      api_key_prefix: prefix,
      status: "active",
    }),
  }
);
const upserted = await upsertResp.json();
if (!Array.isArray(upserted) || upserted.length === 0) {
  console.error("upsert failed:", upserted);
  process.exit(1);
}
console.log(`[smoke] agent ready: id=${upserted[0].id} key=${raw}`);

// ---- Build optimal plan -----------------------------------
// Hand-derived in the migration comment: hits every order on time using
// a single recharge. 22 actions total, expected score $160 (full revenue).
const plan = [
  { action: "move", to: [2, 1] },   // → o2 pickup
  { action: "pickup", order: "o2" },
  { action: "move", to: [1, 2] },   // → o1 pickup
  { action: "pickup", order: "o1" },
  { action: "move", to: [3, 8] },   // → o1 deliver (t=15 ≤ 25 ✓)
  { action: "deliver", order: "o1" },
  { action: "move", to: [4, 9] },   // → o2 deliver (t=18 ≤ 30 ✓)
  { action: "deliver", order: "o2" },
  { action: "move", to: [1, 9] },   // → o5 pickup
  { action: "pickup", order: "o5" },
  { action: "move", to: [7, 8] },   // → o5 deliver (t=30 ≤ 80 ✓)
  { action: "deliver", order: "o5" },
  { action: "move", to: [5, 5] },   // → charging station
  { action: "charge" },
  { action: "move", to: [7, 1] },   // → o3 pickup
  { action: "pickup", order: "o3" },
  { action: "move", to: [8, 6] },   // → o4 pickup
  { action: "pickup", order: "o4" },
  { action: "move", to: [9, 3] },   // → o3 deliver
  { action: "deliver", order: "o3" },
  { action: "move", to: [3, 5] },   // → o4 deliver
  { action: "deliver", order: "o4" },
];

// ---- Call MCP server --------------------------------------
const mcpBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "submit",
    arguments: {
      task_slug: "agentic-rider-mini",
      payload: { plan },
      runtime: {
        client: "smoke-test",
        model: "hand-rolled-optimal",
        duration_ms: 0,
      },
    },
  },
};

const mcpResp = await fetch(MCP_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${raw}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify(mcpBody),
});

const text = await mcpResp.text();
console.log(`[smoke] MCP status: ${mcpResp.status}`);
console.log(`[smoke] MCP body:\n${text}\n`);

// ---- Clean up: ban the test agent -------------------------
await sb(`/agents?slug=eq.${slug}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "banned" }),
});
console.log("[smoke] test agent banned");

// ---- Validate result --------------------------------------
let parsed;
try {
  parsed = JSON.parse(text);
} catch (e) {
  console.error("Could not parse MCP response as JSON:", e);
  process.exit(1);
}
const content = parsed?.result?.content?.[0]?.text;
if (!content) {
  console.error("MCP response has no content:", parsed);
  process.exit(1);
}
const inner = JSON.parse(content);
console.log("[smoke] inner result:", JSON.stringify(inner, null, 2));

if (inner.ok !== true) {
  console.error("submit returned ok:false");
  process.exit(1);
}
if (inner.score !== 160) {
  console.error(`Expected score 160, got ${inner.score}`);
  process.exit(1);
}
if (inner.delivered_on_time !== 5) {
  console.error(`Expected 5 on-time, got ${inner.delivered_on_time}`);
  process.exit(1);
}
if (inner.illegal_actions !== 0) {
  console.error(`Expected 0 illegal, got ${inner.illegal_actions}`);
  process.exit(1);
}
console.log("[smoke] ✓ score=$160, all 5 delivered on time, 0 illegal actions");
