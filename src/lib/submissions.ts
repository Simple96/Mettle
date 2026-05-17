import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  gradeRegexRoulette,
  type CaseResult,
} from "@/lib/grading/regex-roulette";
import { loadTaskForGrading } from "@/lib/tasks";

export type SubmissionTask = {
  id: string;
  slug: string;
  type: string;
  category: string;
  status: string;
  title: string;
  mcp_only: boolean;
  auto_grader_config: unknown;
};

export type AuthMethod = "cookie" | "bearer" | "mcp";

/**
 * Look up a task by slug, validate it's open, the grader is supported, AND
 * that the caller's auth method is allowed for this task.
 *
 * MCP-only tasks reject cookie-auth submissions and direct the operator to
 * the integrations page instead.
 */
export async function findOpenTaskBySlug(
  slug: string,
  opts: { authMethod: AuthMethod } = { authMethod: "cookie" }
): Promise<
  | { ok: true; task: SubmissionTask }
  | { ok: false; status: number; error: string }
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tasks")
    .select(
      "id,slug,type,category,status,title,mcp_only,auto_grader_config"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return { ok: false, status: 404, error: "task not found" };

  const task = { ...(data as Omit<SubmissionTask, "mcp_only">), mcp_only: (data as { mcp_only?: boolean | null }).mcp_only ?? false } as SubmissionTask;

  if (task.status !== "open") {
    return {
      ok: false,
      status: 409,
      error: `task is ${task.status}, not accepting submissions`,
    };
  }

  if (task.mcp_only && opts.authMethod === "cookie") {
    return {
      ok: false,
      status: 403,
      error:
        "This task is MCP-only. Connect an agent via /dashboard/integrations and submit programmatically.",
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

/**
 * Self-reported runtime metadata attached to a submission. Optional; loose
 * schema by design. Recommended fields documented in AGENT_RUNTIME.md §4.6.
 */
export type SubmissionRuntime = {
  model?: string;
  provider?: string;
  client?: string;
  llm_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  // Free-form extras allowed; only documented fields render in UI.
  [k: string]: unknown;
};

export type SubmissionResult =
  | {
      ok: true;
      submission_id: string;
      score: number;
      raw_correct: number;
      total: number;
      regex_length: number;
      duration_ms: number;
      /**
       * Per-case results for ONLY the public test cases. Hidden cases never
       * appear here, even though they are part of the score.
       */
      cases: CaseResult[];
      /**
       * How many of the cases were graded total (public + hidden). Useful
       * for the agent to know "I was graded on N cases, you see X."
       */
      hidden_case_count: number;
    }
  | {
      ok: false;
      status: number;
      error: string;
      reason?: string;
    };

/**
 * Grades a regex submission and persists submission + verdict.
 *
 * Loads hidden test cases via `loadTaskForGrading` (admin client / RLS-bypass)
 * and runs the grader over the merged public+hidden set. The response and
 * `audit_log` only contain PUBLIC case results — hidden cases are never
 * surfaced anywhere a client can read them.
 *
 * Shared between:
 *   - /api/submissions          (cookie auth, web form)
 *   - /api/v1/submissions       (bearer auth, REST)
 *   - MCP tool `submit`         (MCP transport)
 */
export async function gradeAndSaveRegexSubmission(input: {
  taskSlug: string;
  agentId: string;
  regex: string;
  runtime?: SubmissionRuntime;
  // Which surface the submission came through; recorded in audit log.
  source?: AuthMethod;
}): Promise<SubmissionResult> {
  const loaded = await loadTaskForGrading(input.taskSlug);
  if (!loaded) {
    return { ok: false, status: 404, error: "task not found" };
  }
  const { task, fullGraderConfig } = loaded;

  const publicCfg = (task.auto_grader_config ?? {}) as {
    test_cases?: Array<unknown>;
  };
  const publicCount = Array.isArray(publicCfg.test_cases)
    ? publicCfg.test_cases.length
    : 0;

  const result = gradeRegexRoulette(input.regex, fullGraderConfig);

  if (!result.ok) {
    return {
      ok: false,
      status: 400,
      error: result.message,
      reason: result.reason,
    };
  }

  // SPLIT cases: the first `publicCount` are public; the rest are hidden.
  // We only ever return / persist the public ones.
  const publicCases = result.cases.slice(0, publicCount);
  const hiddenCaseCount = Math.max(0, result.cases.length - publicCount);

  const admin = createAdminClient();
  const auditLog = {
    grader: "regex_roulette",
    submitted_regex: input.regex,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    // Only public-case results in the audit log; hidden case results are
    // intentionally discarded.
    cases: publicCases,
    hidden_case_count: hiddenCaseCount,
    runtime: input.runtime ?? null,
    source: input.source ?? null,
  };
  const nowIso = new Date().toISOString();

  const { data: upserted, error: upsertErr } = await admin
    .from("submissions")
    .upsert(
      {
        task_id: task.id,
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
    task_category: task.category,
    task_type: task.type,
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
    cases: publicCases,
    hidden_case_count: hiddenCaseCount,
  };
}
