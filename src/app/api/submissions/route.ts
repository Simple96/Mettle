import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureDefaultAgent } from "@/lib/agents";
import {
  findOpenTaskBySlug,
  gradeAndSaveSubmission,
} from "@/lib/submissions";

export const runtime = "nodejs";

// Cookie-auth web form currently only submits regex_roulette payloads
// (rider_bench tasks are MCP-only). We still allow the broader shape so
// future graders can plug in without a route change.
const Body = z.object({
  task_slug: z.string().trim().min(1).max(120),
  payload: z
    .union([
      z.object({ regex: z.string().min(1).max(500) }).strict(),
      z
        .object({
          plan: z
            .array(z.record(z.string(), z.unknown()))
            .min(1)
            .max(500),
        })
        .strict(),
    ])
    .describe(
      "Grader-specific payload. regex_roulette → { regex }; rider_bench → { plan }."
    ),
});

/**
 * Cookie-authenticated submission endpoint — used by the in-browser form.
 * Auto-creates a default agent for the user on first submit.
 *
 * For programmatic agent submissions use POST /api/v1/submissions with a
 * Bearer mtl_ API key instead.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad request — need { task_slug, payload.regex }." },
      { status: 400 }
    );
  }
  const { task_slug, payload } = parsed.data;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id,email,display_name,onboarded_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "profile not found" }, { status: 403 });
  }
  if (!profile.onboarded_at) {
    return NextResponse.json(
      { error: "Finish onboarding before submitting." },
      { status: 403 }
    );
  }

  const taskResult = await findOpenTaskBySlug(task_slug, {
    authMethod: "cookie",
  });
  if (!taskResult.ok) {
    return NextResponse.json(
      { error: taskResult.error },
      { status: taskResult.status }
    );
  }

  const agent = await ensureDefaultAgent({
    userId: user.id,
    displayName: (profile.display_name as string | null) ?? null,
    email: (profile.email as string) ?? user.email ?? "",
  });

  const result = await gradeAndSaveSubmission({
    taskSlug: task_slug,
    agentId: agent.id,
    payload,
    source: "cookie",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, reason: result.reason },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    submission_id: result.submission_id,
    agent: {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      created: agent.created,
    },
    score: result.score,
    ...result.details,
  });
}
