import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureUniqueSlug } from "@/lib/slugify";

/**
 * Server-only utilities for publisher-owned market tasks.
 *
 * The store path mirrors how Arena tasks are managed:
 *   - Public test cases   →  tasks.auto_grader_config.test_cases
 *   - Hidden test cases   →  task_hidden_data.data.test_cases  (RLS service-role only)
 *
 * We deliberately use the admin (service-role) client throughout. This gives
 * us atomic two-table writes (tasks + task_hidden_data) and lets us bypass
 * the RLS `tasks_publisher_all` policy's auth.uid() check from a route handler
 * where the Supabase auth context can be flaky. Caller is responsible for
 * verifying the user via cookies before invoking these functions.
 */

// ============================================================
// Validation
// ============================================================

const TestCaseSchema = z.object({
  input: z.string().min(0).max(2000),
  should_match: z.boolean(),
  weight: z.number().int().min(1).max(10).optional(),
});

export const CreateMarketTaskSchema = z.object({
  title: z.string().trim().min(4).max(120),
  description: z.string().trim().min(20).max(8000),
  category: z
    .enum(["code", "data", "writing", "ml", "ops", "other"])
    .default("code"),
  deadline: z
    .string()
    .refine(
      (s) => !Number.isNaN(Date.parse(s)) && Date.parse(s) > Date.now(),
      "deadline must be a future ISO timestamp"
    ),
  prize_pool_cents: z.number().int().min(0).max(100_000_00).default(0),
  grader: z.literal("regex_roulette"),
  max_regex_length: z.number().int().min(8).max(500).default(200),
  public_cases: z.array(TestCaseSchema).min(3).max(50),
  hidden_cases: z.array(TestCaseSchema).max(200).default([]),
  mcp_only: z.boolean().default(false),
});

export type CreateMarketTaskInput = z.infer<typeof CreateMarketTaskSchema>;

// ============================================================
// Create
// ============================================================

export type CreatedTask = {
  id: string;
  slug: string;
  title: string;
  status: string;
};

/**
 * Insert a new market task on behalf of `publisherId`. Atomic-ish:
 * the hidden-cases write is best-effort after the task insert. If it fails
 * we delete the task row to avoid orphans.
 */
export async function createMarketTask(args: {
  publisherId: string;
  input: CreateMarketTaskInput;
}): Promise<
  | { ok: true; task: CreatedTask }
  | { ok: false; status: number; error: string }
> {
  const admin = createAdminClient();
  const { input, publisherId } = args;

  const slug = await ensureUniqueSlug(input.title, async (candidate) => {
    const { data } = await admin
      .from("tasks")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    return !!data;
  });

  const publishedAt = new Date().toISOString();

  const { data: inserted, error: insertErr } = await admin
    .from("tasks")
    .insert({
      type: "market_tournament",
      category: input.category,
      slug,
      publisher_id: publisherId,
      title: input.title,
      description: input.description,
      rubric: {
        auto_grader: "regex_roulette",
        human_review: false,
        tiebreaker: "shorter_regex_wins",
        visibility: input.mcp_only ? "mcp_only" : "public",
      },
      auto_grader_config: {
        kind: "regex_roulette",
        max_regex_length: input.max_regex_length,
        test_cases: input.public_cases,
      },
      prize_pool_cents: input.prize_pool_cents,
      prize_breakdown: {},
      max_participants: null,
      deadline: new Date(input.deadline).toISOString(),
      status: "open",
      mcp_only: input.mcp_only,
      published_at: publishedAt,
    })
    .select("id,slug,title,status")
    .single();

  if (insertErr || !inserted) {
    console.error("[publisher] tasks insert failed:", insertErr);
    return {
      ok: false,
      status: 500,
      error: insertErr?.message ?? "Could not create task.",
    };
  }

  if (input.hidden_cases.length > 0) {
    const { error: hiddenErr } = await admin.from("task_hidden_data").insert({
      task_id: inserted.id as string,
      data: {
        kind: "regex_roulette",
        test_cases: input.hidden_cases,
      },
    });
    if (hiddenErr) {
      console.error("[publisher] hidden_data insert failed, rolling back task:", hiddenErr);
      await admin.from("tasks").delete().eq("id", inserted.id as string);
      return {
        ok: false,
        status: 500,
        error: "Could not save hidden test cases — task creation rolled back.",
      };
    }
  }

  return {
    ok: true,
    task: {
      id: inserted.id as string,
      slug: inserted.slug as string,
      title: inserted.title as string,
      status: inserted.status as string,
    },
  };
}

// ============================================================
// List (publisher's own tasks)
// ============================================================

export type PublisherTaskSummary = {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  mcp_only: boolean;
  prize_pool_cents: number;
  deadline: string;
  published_at: string | null;
  submission_count: number;
};

export async function listPublisherTasks(
  publisherId: string
): Promise<PublisherTaskSummary[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tasks")
    .select(
      "id,slug,title,category,status,mcp_only,prize_pool_cents,deadline,published_at"
    )
    .eq("publisher_id", publisherId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[publisher] listPublisherTasks failed:", error);
    return [];
  }
  const tasks = (data ?? []) as Array<Omit<PublisherTaskSummary, "submission_count">>;
  if (tasks.length === 0) return [];

  // Submission counts per task — small N, head requests are fine for MVP.
  const counts = await Promise.all(
    tasks.map(async (t) => {
      const { count } = await admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("task_id", t.id);
      return [t.id, count ?? 0] as const;
    })
  );
  const countMap = new Map(counts);
  return tasks.map((t) => ({
    ...t,
    submission_count: countMap.get(t.id) ?? 0,
  }));
}

// ============================================================
// Close (publisher-initiated)
// ============================================================

export async function closeTask(args: {
  taskId: string;
  publisherId: string;
  reason: "settled" | "cancelled";
}): Promise<
  | { ok: true; status: string }
  | { ok: false; status: number; error: string }
> {
  const admin = createAdminClient();
  const { data: existing, error: findErr } = await admin
    .from("tasks")
    .select("id,publisher_id,status")
    .eq("id", args.taskId)
    .maybeSingle();
  if (findErr || !existing) {
    return { ok: false, status: 404, error: "task not found" };
  }
  if ((existing.publisher_id as string | null) !== args.publisherId) {
    return { ok: false, status: 403, error: "not your task" };
  }
  if ((existing.status as string) !== "open") {
    return {
      ok: false,
      status: 409,
      error: `task is ${existing.status}, cannot close`,
    };
  }
  const { error: updErr } = await admin
    .from("tasks")
    .update({ status: args.reason })
    .eq("id", args.taskId);
  if (updErr) {
    return { ok: false, status: 500, error: updErr.message };
  }
  return { ok: true, status: args.reason };
}
