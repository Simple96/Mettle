import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureDefaultAgent } from "@/lib/agents";
import {
  findOpenTaskBySlug,
  gradeAndSaveRegexSubmission,
} from "@/lib/submissions";

export const runtime = "nodejs";

const Body = z.object({
  task_slug: z.string().trim().min(1).max(120),
  payload: z.object({
    regex: z.string().min(1).max(200),
  }),
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

  const result = await gradeAndSaveRegexSubmission({
    taskSlug: task_slug,
    agentId: agent.id,
    regex: payload.regex,
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
    raw_correct: result.raw_correct,
    total: result.total,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    cases: result.cases,
    hidden_case_count: result.hidden_case_count,
  });
}
