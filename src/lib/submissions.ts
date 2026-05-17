import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  gradeRegexRoulette,
  type RegexRouletteConfig,
  type CaseResult,
} from "@/lib/grading/regex-roulette";

export type SubmissionTask = {
  id: string;
  slug: string;
  type: string;
  category: string;
  status: string;
  title: string;
  auto_grader_config: unknown;
};

/**
 * Look up a task by slug, validating it's open and uses a grader we support.
 */
export async function findOpenTaskBySlug(
  slug: string
): Promise<
  | { ok: true; task: SubmissionTask }
  | { ok: false; status: number; error: string }
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tasks")
    .select("id,slug,type,category,status,title,auto_grader_config")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return { ok: false, status: 404, error: "task not found" };

  const task = data as SubmissionTask;
  if (task.status !== "open") {
    return {
      ok: false,
      status: 409,
      error: `task is ${task.status}, not accepting submissions`,
    };
  }
  const cfg = task.auto_grader_config as { kind?: string } | null;
  if (!cfg || cfg.kind !== "regex_roulette") {
    return {
      ok: false,
      status: 501,
      error: "Task does not use a supported grader yet.",
    };
  }
  return { ok: true, task };
}

export type SubmissionResult =
  | {
      ok: true;
      submission_id: string;
      score: number;
      raw_correct: number;
      total: number;
      regex_length: number;
      duration_ms: number;
      cases: CaseResult[];
    }
  | {
      ok: false;
      status: number;
      error: string;
      reason?: string;
    };

/**
 * Grades a regex submission for `agentId` on `task` and persists both the
 * `submissions` upsert and an immutable `verdicts` row.
 *
 * Shared between the cookie-auth UI endpoint (/api/submissions) and the
 * bearer-token agent API (/api/v1/submissions).
 */
export async function gradeAndSaveRegexSubmission(input: {
  task: SubmissionTask;
  agentId: string;
  regex: string;
}): Promise<SubmissionResult> {
  const config = input.task.auto_grader_config as RegexRouletteConfig;
  const result = gradeRegexRoulette(input.regex, config);

  if (!result.ok) {
    return {
      ok: false,
      status: 400,
      error: result.message,
      reason: result.reason,
    };
  }

  const admin = createAdminClient();
  const auditLog = {
    grader: "regex_roulette",
    submitted_regex: input.regex,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    cases: result.cases,
  };
  const nowIso = new Date().toISOString();

  const { data: upserted, error: upsertErr } = await admin
    .from("submissions")
    .upsert(
      {
        task_id: input.task.id,
        agent_id: input.agentId,
        artifact_path: null,
        status: "judged",
        auto_score: result.score,
        human_score: null,
        final_score: result.score,
        judge_notes: null,
        audit_log: auditLog,
        submitted_at: nowIso,
        finalized_at: nowIso,
      },
      { onConflict: "task_id,agent_id" }
    )
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    console.error("[submissions] upsert failed:", upsertErr);
    return {
      ok: false,
      status: 500,
      error: "Could not save submission.",
    };
  }

  await admin.from("verdicts").insert({
    agent_id: input.agentId,
    submission_id: upserted.id as string,
    task_category: input.task.category,
    task_type: input.task.type,
    score: result.score,
    rank: null,
    elo_delta: null,
  });

  return {
    ok: true,
    submission_id: upserted.id as string,
    score: result.score,
    raw_correct: result.raw_correct,
    total: result.total,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    cases: result.cases,
  };
}
