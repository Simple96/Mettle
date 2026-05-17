import "server-only";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintApiKey } from "@/lib/api-keys";

type EnsureAgentInput = {
  userId: string;
  displayName: string | null;
  email: string;
};

type EnsuredAgent = {
  id: string;
  slug: string;
  name: string;
  created: boolean;
};

/**
 * Idempotently returns this user's "default agent" — auto-creating one on
 * first submission. Lets people start submitting to Arena without going
 * through a separate agent-registration flow.
 *
 * Slug generation: prefer a sluggified display_name. On collision (very
 * common for "han", "alex", etc.), append a 4-char random suffix and retry.
 */
export async function ensureDefaultAgent(
  input: EnsureAgentInput
): Promise<EnsuredAgent> {
  const admin = createAdminClient();

  const existing = await admin
    .from("agents")
    .select("id,slug,name")
    .eq("operator_id", input.userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.data) {
    return {
      id: existing.data.id as string,
      slug: existing.data.slug as string,
      name: existing.data.name as string,
      created: false,
    };
  }

  const base = sluggify(input.displayName || input.email.split("@")[0]) || "agent";
  const name = input.displayName || input.email.split("@")[0] || "agent";

  // Try base, then base-xxxx if taken. Cap at 5 attempts; on the 5th try a
  // user-id-derived hash to guarantee global uniqueness.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSuffix(4)}`;
    const apiKey = mintApiKey();
    const { data, error } = await admin
      .from("agents")
      .insert({
        slug,
        operator_id: input.userId,
        name,
        description: null,
        categories: [],
        api_key_hash: apiKey.hash,
        api_key_prefix: apiKey.prefix,
        status: "active",
      })
      .select("id,slug,name")
      .single();

    if (!error && data) {
      return {
        id: data.id as string,
        slug: data.slug as string,
        name: data.name as string,
        created: true,
      };
    }
    if (error?.code !== "23505") {
      lastError = error;
      break;
    }
    lastError = error;
  }

  // Final fallback: deterministic slug from user id hash.
  const fallback = `${base}-${input.userId.slice(0, 6)}`;
  const apiKey = mintApiKey();
  const { data, error } = await admin
    .from("agents")
    .insert({
      slug: fallback,
      operator_id: input.userId,
      name,
      api_key_hash: apiKey.hash,
      api_key_prefix: apiKey.prefix,
      status: "active",
    })
    .select("id,slug,name")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create default agent: ${
        error?.message ?? (lastError instanceof Error ? lastError.message : "unknown")
      }`
    );
  }

  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    created: true,
  };
}

function sluggify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function randomSuffix(n: number): string {
  return randomBytes(8).toString("hex").slice(0, n);
}

/**
 * Rotates the API key for an agent the caller owns. Returns the raw key —
 * caller is responsible for showing it to the user EXACTLY ONCE.
 *
 * Verifies ownership before rotating (defense in depth on top of RLS).
 */
export async function rotateAgentApiKey(input: {
  agentId: string;
  operatorUserId: string;
}): Promise<{ rawKey: string; prefix: string } | { error: string }> {
  const admin = createAdminClient();

  const { data: agent, error: fetchErr } = await admin
    .from("agents")
    .select("id,operator_id")
    .eq("id", input.agentId)
    .maybeSingle();

  if (fetchErr || !agent) return { error: "agent not found" };
  if ((agent.operator_id as string) !== input.operatorUserId) {
    return { error: "forbidden" };
  }

  const minted = mintApiKey();
  const { error: updErr } = await admin
    .from("agents")
    .update({
      api_key_hash: minted.hash,
      api_key_prefix: minted.prefix,
    })
    .eq("id", input.agentId);

  if (updErr) return { error: updErr.message };
  return { rawKey: minted.raw, prefix: minted.prefix };
}
