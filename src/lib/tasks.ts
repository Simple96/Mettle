import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { RegexRouletteConfig } from "@/lib/grading/regex-roulette";
import type { RiderBenchConfig } from "@/lib/grading/rider-bench";

/**
 * Union of every grader config the platform supports. Callers can narrow
 * by `kind` to access grader-specific fields.
 */
export type FullGraderConfig = RegexRouletteConfig | RiderBenchConfig;

/**
 * Task views and grader-data loaders.
 *
 * Two strict layers prevent hidden-test leakage:
 *   1. `publicTaskView()` strips anything grader-internal.
 *   2. Hidden test cases live in `task_hidden_data` (RLS service-role only)
 *      — they're not even in the same row that public APIs query.
 *
 * The grader path uses `loadTaskForGrading()` which MERGES hidden cases in
 * — this is the only function that should reveal hidden data, and it's
 * server-only.
 */

export type PublicTask = {
  id: string;
  slug: string;
  type: string;
  category: string;
  title: string;
  description: string;
  status: string;
  mcp_only: boolean;
  deadline: string;
  published_at: string | null;
  auto_grader_config: PublicGraderConfig;
  rubric: unknown;
};

/**
 * Grader config as seen by clients — same shape as the DB but stripped of
 * anything that should never reach a client (currently nothing, since hidden
 * cases live in a separate table; left here as a future safety net).
 */
export type PublicGraderConfig = {
  kind: string;
  max_regex_length?: number;
  test_cases?: Array<{
    input: string;
    should_match: boolean;
    weight?: number;
  }>;
  [k: string]: unknown;
};

type TaskRow = {
  id: string;
  slug: string;
  type: string;
  category: string;
  title: string;
  description: string;
  status: string;
  mcp_only: boolean | null;
  deadline: string;
  published_at: string | null;
  auto_grader_config: unknown;
  rubric: unknown;
};

/**
 * Strip a raw DB row down to a client-safe shape.
 *
 * Today this is mostly a passthrough since hidden data is in a separate
 * table. If we ever store sensitive fields inline (e.g. seeded RNG seeds),
 * we add the strip logic here in one place.
 */
export function publicTaskView(row: TaskRow): PublicTask {
  const cfg = (row.auto_grader_config ?? {}) as PublicGraderConfig;
  // Defensive: explicitly omit any future fields we want hidden.
  const { test_cases_hidden: _hidden, ...safeCfg } = cfg as PublicGraderConfig & {
    test_cases_hidden?: unknown;
  };
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    category: row.category,
    title: row.title,
    description: row.description,
    status: row.status,
    mcp_only: row.mcp_only ?? false,
    deadline: row.deadline,
    published_at: row.published_at,
    auto_grader_config: safeCfg,
    rubric: row.rubric,
  };
}

/**
 * List open tasks. Public view only — never reveals hidden data.
 */
export async function listOpenTasks(opts: {
  category?: string;
  limit?: number;
} = {}): Promise<PublicTask[]> {
  const admin = createAdminClient();
  let q = admin
    .from("tasks")
    .select(
      "id,slug,type,category,title,description,status,mcp_only,deadline,published_at,auto_grader_config,rubric"
    )
    .eq("status", "open")
    .order("published_at", { ascending: false });
  if (opts.category) q = q.eq("category", opts.category);
  q = q.limit(Math.min(opts.limit ?? 50, 100));
  const { data, error } = await q;
  if (error) throw new Error(`listOpenTasks failed: ${error.message}`);
  return ((data ?? []) as unknown as TaskRow[]).map(publicTaskView);
}

/**
 * Fetch a single task by slug. Public view only.
 */
export async function getPublicTaskBySlug(
  slug: string
): Promise<PublicTask | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tasks")
    .select(
      "id,slug,type,category,title,description,status,mcp_only,deadline,published_at,auto_grader_config,rubric"
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getPublicTaskBySlug failed: ${error.message}`);
  if (!data) return null;
  return publicTaskView(data as unknown as TaskRow);
}

/**
 * Grader-side loader. Returns the task AND merges hidden test cases (from
 * `task_hidden_data`) into the grader config so the grader sees the full set.
 *
 * This is the ONLY function that returns hidden data. Use only from worker
 * / grader paths, never from a public-facing handler.
 */
export async function loadTaskForGrading(slug: string): Promise<{
  task: TaskRow;
  fullGraderConfig: FullGraderConfig;
} | null> {
  const admin = createAdminClient();

  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select(
      "id,slug,type,category,title,description,status,mcp_only,deadline,published_at,auto_grader_config,rubric"
    )
    .eq("slug", slug)
    .maybeSingle();
  if (taskErr || !task) return null;

  const taskRow = task as unknown as TaskRow;
  const publicCfg = (taskRow.auto_grader_config ?? {}) as PublicGraderConfig;
  // Non-regex graders (rider_bench, future kinds) don't have a hidden
  // companion — their full scenario is in `auto_grader_config`.
  if (publicCfg.kind !== "regex_roulette") {
    return {
      task: taskRow,
      fullGraderConfig: publicCfg as unknown as FullGraderConfig,
    };
  }

  const { data: hidden, error: hiddenErr } = await admin
    .from("task_hidden_data")
    .select("data")
    .eq("task_id", taskRow.id)
    .maybeSingle();

  if (hiddenErr) {
    // Hidden data is best-effort to merge; if it's gone the grader still
    // works on the public cases. Surface in logs.
    console.error(
      `[tasks] task_hidden_data load failed for ${slug}:`,
      hiddenErr.message
    );
  }

  const publicCases = Array.isArray(publicCfg.test_cases)
    ? publicCfg.test_cases
    : [];
  const hiddenCases = Array.isArray(
    (hidden?.data as { test_cases?: unknown })?.test_cases
  )
    ? ((hidden?.data as { test_cases: typeof publicCases }).test_cases)
    : [];

  return {
    task: taskRow,
    fullGraderConfig: {
      kind: "regex_roulette",
      max_regex_length: publicCfg.max_regex_length ?? 200,
      test_cases: [...publicCases, ...hiddenCases],
    },
  };
}
