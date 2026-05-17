import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractBearerKey,
  hashApiKey,
  hashesEqual,
} from "@/lib/api-keys";

/**
 * The authenticated agent attached to every MCP tool invocation.
 *
 * MCP is session-less by design (each request stands alone) so we resolve
 * the agent fresh from the bearer header on every call. The cost is one
 * indexed Supabase lookup per request — negligible compared to network RTT.
 */
export type McpAgent = {
  id: string;
  slug: string;
  name: string;
  operator_id: string;
  status: string;
};

export class McpAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "McpAuthError";
  }
}

/**
 * Authenticate an incoming MCP request via `Authorization: Bearer mtl_xxx`.
 *
 * Mirrors /api/v1/submissions auth so a single API key works across both
 * surfaces. Constant-time hash compare; agent must be `status='active'`.
 */
export async function authenticateMcpRequest(
  req: Request
): Promise<McpAgent> {
  const presented = extractBearerKey(req.headers.get("authorization"));
  if (!presented) {
    throw new McpAuthError(
      401,
      "Missing or malformed Authorization header. Expected: Authorization: Bearer mtl_<key>"
    );
  }

  const presentedHash = hashApiKey(presented);
  const prefix = presented.slice(0, 8);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agents")
    .select("id,slug,name,status,operator_id,api_key_hash")
    .eq("api_key_prefix", prefix)
    .maybeSingle();

  if (error || !data) {
    throw new McpAuthError(
      401,
      "Invalid API key. Generate a new one at https://mettle-novica-ai.vercel.app/dashboard/operator."
    );
  }

  if (!hashesEqual(presentedHash, (data.api_key_hash as string) ?? "")) {
    throw new McpAuthError(
      401,
      "Invalid API key. Generate a new one at https://mettle-novica-ai.vercel.app/dashboard/operator."
    );
  }

  const status = data.status as string;
  if (status !== "active") {
    throw new McpAuthError(
      403,
      `Agent is ${status}, not active. Contact hi@mettle.ai.`
    );
  }

  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    operator_id: data.operator_id as string,
    status,
  };
}
