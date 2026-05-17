import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  gradeRegexRoulette,
  type CaseResult,
} from "@/lib/grading/regex-roulette";
import {
  gradeRiderBench,
  type RiderBenchConfig,
  type TraceStep,
} from "@/lib/grading/rider-bench";
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

/** Graders the platform knows how to run. */
export type GraderKind = "regex_roulette" | "rider_bench";

const SUPPORTED_GRADERS: ReadonlySet<GraderKind> = new Set([
  "regex_roulette",
  "rider_bench",
]);

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
  if (!cfg || !SUPPORTED_GRADERS.has(cfg.kind as GraderKind)) {
    return {
      ok: false,
      status: 501,
      error: `Task uses unsupported grader '${cfg?.kind ?? "none"}'.`,
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

/**
 * Public, grader-specific detail bundle. We keep the response shape
 * uniform (`ok / submission_id / score / grader / details`) so callers
 * only need to spread `details` into their JSON response; the agent /
 * client interprets the inner shape based on `grader`.
 */
export type SubmissionDetails =
  | {
      grader: "regex_roulette";
      raw_correct: number;
      total: number;
      regex_length: number;
      duration_ms: number;
      // Public-case results only. Hidden cases never appear here.
      public_cases: CaseResult[];
      hidden_case_count: number;
    }
  | {
      grader: "rider_bench";
      plan_length: number;
      duration_ms: number;
      revenue: number;
      max_revenue: number;
      delivered_on_time: number;
      delivered_late: number;
      picked_up: number;
      total_orders: number;
      illegal_actions: number;
      time_spent: number;
      battery_remaining: number;
      // Trace of every step (action + post-state). Full visibility since
      // the scenario itself is fully public.
      trace: TraceStep[];
    };

export type SubmissionResult =
  | {
      ok: true;
      submission_id: string;
      score: number;
      grader: GraderKind;
      details: SubmissionDetails;
    }
  | {
      ok: false;
      status: number;
      error: string;
      reason?: string;
    };

/**
 * Generic submission entry point: takes a task slug + arbitrary payload,
 * dispatches to the right grader, persists submission + verdict, returns
 * a uniform result envelope.
 *
 * Shared between:
 *   - /api/submissions          (cookie auth, web form)
 *   - /api/v1/submissions       (bearer auth, REST)
 *   - MCP tool `submit`         (MCP transport)
 *
 * Hidden test data is loaded via `loadTaskForGrading` (admin client,
 * RLS-bypass) when applicable. Hidden case content is stripped from the
 * returned `details` before it ever crosses the trust boundary.
 */
export async function gradeAndSaveSubmission(input: {
  taskSlug: string;
  agentId: string;
  payload: unknown;
  runtime?: SubmissionRuntime;
  source?: AuthMethod;
}): Promise<SubmissionResult> {
  const loaded = await loadTaskForGrading(input.taskSlug);
  if (!loaded) {
    return { ok: false, status: 404, error: "task not found" };
  }
  const { task, fullGraderConfig } = loaded;
  const kind = (fullGraderConfig as { kind?: string }).kind as GraderKind;

  if (kind === "regex_roulette") {
    return await runRegexRoulette({
      task,
      fullGraderConfig: fullGraderConfig as Parameters<typeof gradeRegexRoulette>[1],
      input,
    });
  }
  if (kind === "rider_bench") {
    return await runRiderBench({
      task,
      fullGraderConfig: fullGraderConfig as RiderBenchConfig,
      input,
    });
  }
  return {
    ok: false,
    status: 501,
    error: `Unsupported grader '${kind}'.`,
  };
}

// ============================================================
// Grader dispatchers (private)
// ============================================================

async function runRegexRoulette(args: {
  task: Awaited<ReturnType<typeof loadTaskForGrading>> extends { task: infer T } | null
    ? T
    : never;
  fullGraderConfig: Parameters<typeof gradeRegexRoulette>[1];
  input: {
    agentId: string;
    payload: unknown;
    runtime?: SubmissionRuntime;
    source?: AuthMethod;
  };
}): Promise<SubmissionResult> {
  // Payload validation specific to this grader.
  const payload = args.input.payload as { regex?: unknown };
  if (!payload || typeof payload.regex !== "string") {
    return {
      ok: false,
      status: 400,
      error: "Payload must be { regex: string } for regex_roulette tasks.",
    };
  }

  const publicCfg = (args.task.auto_grader_config ?? {}) as {
    test_cases?: Array<unknown>;
  };
  const publicCount = Array.isArray(publicCfg.test_cases)
    ? publicCfg.test_cases.length
    : 0;

  const result = gradeRegexRoulette(payload.regex, args.fullGraderConfig);
  if (!result.ok) {
    return { ok: false, status: 400, error: result.message, reason: result.reason };
  }

  // SPLIT cases: first `publicCount` are public; the rest hidden.
  // Only public cases are persisted or returned.
  const publicCases = result.cases.slice(0, publicCount);
  const hiddenCaseCount = Math.max(0, result.cases.length - publicCount);

  const details: SubmissionDetails = {
    grader: "regex_roulette",
    raw_correct: result.raw_correct,
    total: result.total,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    public_cases: publicCases,
    hidden_case_count: hiddenCaseCount,
  };
  const auditLog = {
    grader: "regex_roulette",
    submitted_regex: payload.regex,
    regex_length: result.regex_length,
    duration_ms: result.duration_ms,
    cases: publicCases,
    hidden_case_count: hiddenCaseCount,
    runtime: args.input.runtime ?? null,
    source: args.input.source ?? null,
  };

  return await persistAndReturn({
    task: args.task,
    agentId: args.input.agentId,
    score: result.score,
    auditLog,
    details,
    grader: "regex_roulette",
  });
}

async function runRiderBench(args: {
  task: Awaited<ReturnType<typeof loadTaskForGrading>> extends { task: infer T } | null
    ? T
    : never;
  fullGraderConfig: RiderBenchConfig;
  input: {
    agentId: string;
    payload: unknown;
    runtime?: SubmissionRuntime;
    source?: AuthMethod;
  };
}): Promise<SubmissionResult> {
  const payload = args.input.payload as { plan?: unknown };
  if (!payload || !Array.isArray(payload.plan)) {
    return {
      ok: false,
      status: 400,
      error: "Payload must be { plan: Action[] } for rider_bench tasks.",
    };
  }

  const result = gradeRiderBench(payload.plan, args.fullGraderConfig);
  if (!result.ok) {
    return { ok: false, status: 400, error: result.message, reason: result.reason };
  }

  const details: SubmissionDetails = {
    grader: "rider_bench",
    plan_length: result.plan_length,
    duration_ms: result.duration_ms,
    revenue: result.revenue,
    max_revenue: result.max_revenue,
    delivered_on_time: result.delivered_on_time,
    delivered_late: result.delivered_late,
    picked_up: result.picked_up,
    total_orders: result.total_orders,
    illegal_actions: result.illegal_actions,
    time_spent: result.time_spent,
    battery_remaining: result.battery_remaining,
    trace: result.trace,
  };
  const auditLog = {
    grader: "rider_bench",
    submitted_plan: payload.plan,
    plan_length: result.plan_length,
    duration_ms: result.duration_ms,
    revenue: result.revenue,
    max_revenue: result.max_revenue,
    delivered_on_time: result.delivered_on_time,
    delivered_late: result.delivered_late,
    illegal_actions: result.illegal_actions,
    trace: result.trace,
    runtime: args.input.runtime ?? null,
    source: args.input.source ?? null,
  };

  return await persistAndReturn({
    task: args.task,
    agentId: args.input.agentId,
    score: result.score,
    auditLog,
    details,
    grader: "rider_bench",
  });
}

async function persistAndReturn(args: {
  task: { id: string; category: string; type: string };
  agentId: string;
  score: number;
  auditLog: unknown;
  details: SubmissionDetails;
  grader: GraderKind;
}): Promise<SubmissionResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: upserted, error: upsertErr } = await admin
    .from("submissions")
    .upsert(
      {
        task_id: args.task.id,
        agent_id: args.agentId,
        artifact_path: null,
        status: "judged",
        auto_score: args.score,
        human_score: null,
        final_score: args.score,
        judge_notes: null,
        audit_log: args.auditLog,
        submitted_at: nowIso,
        finalized_at: nowIso,
      },
      { onConflict: "task_id,agent_id" }
    )
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    console.error("[submissions] upsert failed:", upsertErr);
    return { ok: false, status: 500, error: "Could not save submission." };
  }

  await admin.from("verdicts").insert({
    agent_id: args.agentId,
    submission_id: upserted.id as string,
    task_category: args.task.category,
    task_type: args.task.type,
    score: args.score,
    rank: null,
    elo_delta: null,
  });

  return {
    ok: true,
    submission_id: upserted.id as string,
    score: args.score,
    grader: args.grader,
    details: args.details,
  };
}
