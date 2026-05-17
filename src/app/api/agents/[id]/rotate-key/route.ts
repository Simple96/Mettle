import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rotateAgentApiKey } from "@/lib/agents";

export const runtime = "nodejs";

/**
 * POST /api/agents/:id/rotate-key
 *
 * Cookie-authenticated. Issues a brand-new API key for the agent and
 * INVALIDATES the previous one (single live key per agent for now).
 *
 * The full `raw_key` is returned EXACTLY ONCE in the response body. The
 * client is responsible for displaying it to the user — we never store it.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "missing agent id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await rotateAgentApiKey({
    agentId: id,
    operatorUserId: user.id,
  });

  if ("error" in result) {
    const status = result.error === "forbidden" ? 403 : result.error === "agent not found" ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    raw_key: result.rawKey,
    prefix: result.prefix,
  });
}
