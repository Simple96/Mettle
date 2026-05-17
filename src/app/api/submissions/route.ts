import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureDefaultAgent } from "@/lib/agents";
import {
  gradeRegexRoulette,
  type RegexRouletteConfig,
} from "@/lib/grading/regex-roulette";

export const runtime = "nodejs"; // safe-regex uses regexp-tree (Node only)

const Body = z.object({
  task_slug: z.string().trim().min(1).max(120),
  payload: z.object({
    regex: z.string().min(1).max(200),
  }),
});

export async function POST(request: Request) {
  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Validate body
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

  // 3. Look up task + profile in parallel
  const [{ data: task, error: taskErr }, { data: profile }] = await Promise.all([
    admin
      .from("tasks")
      .select("id,type,status,slug,title,auto_grader_config")
      .eq("slug", task_slug)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id,email,display_name,onboarded_at,role")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (taskErr || !task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  if (task.status !== "open") {
    return NextResponse.json(
      { error: `task is ${task.status}, not accepting submissions` },
      { status: 409 }
    );
  }
  if (!profile) {
    return NextResponse.json({ error: "profile not found" }, { status: 403 });
  }
  if (!profile.onboarded_at) {
    return NextResponse.json(
      { error: "Finish onboarding before submitting." },
      { status: 403 }
    );
  }

  const config = task.auto_grader_config as RegexRouletteConfig | null;
  if (!config || config.kind !== "regex_roulette") {
    return NextResponse.json(
      { error: "Task does not use a supported grader yet." },
      { status: 501 }
    );
  }

  // 4. Ensure the operator has a default agent
  const agent = await ensureDefaultAgent({
    userId: user.id,
    displayName: (profile.display_name as string | null) ?? null,
    email: (profile.email as string) ?? user.email ?? "",
  });

  // 5. Grade synchronously (regex grader is microseconds-fast)
  const result = gradeRegexRoulette(payload.regex, config);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        reason: result.reason,
      },
      { status: 400 }
    );
  }

  // 6. Upsert submission (unique on task_id, agent_id)
  const auditLog = {
    grader: "regex_roulette",
    submitted_regex: payload.regex,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    cases: result.cases,
  };

  const submissionRow = {
    task_id: task.id as string,
    agent_id: agent.id,
    artifact_path: null,
    status: "judged" as const,
    auto_score: result.score,
    human_score: null,
    final_score: result.score,
    judge_notes: null,
    audit_log: auditLog,
    submitted_at: new Date().toISOString(),
    finalized_at: new Date().toISOString(),
  };

  const { data: upserted, error: upsertErr } = await admin
    .from("submissions")
    .upsert(submissionRow, { onConflict: "task_id,agent_id" })
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    console.error("[submissions] upsert failed:", upsertErr);
    return NextResponse.json(
      { error: "Could not save submission." },
      { status: 500 }
    );
  }

  // 7. Append verdict (immutable history)
  await admin.from("verdicts").insert({
    agent_id: agent.id,
    submission_id: upserted.id as string,
    task_category: "code",
    task_type: task.type as string,
    score: result.score,
    rank: null,
    elo_delta: null,
  });

  return NextResponse.json({
    ok: true,
    submission_id: upserted.id,
    agent: { id: agent.id, slug: agent.slug, name: agent.name, created: agent.created },
    score: result.score,
    raw_correct: result.raw_correct,
    total: result.total,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    cases: result.cases,
  });
}
