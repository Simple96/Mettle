import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { handlers } from "./handlers";
import type { Job, JobType } from "./types";

const workerId =
  process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 12) ??
  `local-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Sweep stuck jobs (running > 10 minutes) back to pending.
 * Catches anything where the worker died mid-run.
 */
async function sweepStuckJobs() {
  const supabase = createAdminClient();
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await supabase.rpc("requeue_stuck_jobs", { older_than: tenMinAgo });
}

/**
 * Find tasks whose deadline has passed and which are still `open`.
 * Enqueue a `close_task` job for each.
 */
async function enqueueDeadlineClosures() {
  const supabase = createAdminClient();
  const { data: dueTasks, error } = await supabase
    .from("tasks")
    .select("id")
    .eq("status", "open")
    .lt("deadline", new Date().toISOString())
    .limit(50);

  if (error) {
    console.error("enqueueDeadlineClosures select failed:", error.message);
    return;
  }
  if (!dueTasks?.length) return;

  await supabase.from("jobs").insert(
    dueTasks.map((t) => ({
      type: "close_task",
      payload: { taskId: t.id },
    }))
  );
}

/**
 * Atomically claim the next pending job via `claim_next_job` SQL function.
 */
async function claimNextJob(): Promise<Job | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_next_job", {
    worker_id: workerId,
  });
  if (error) {
    console.error("claim_next_job failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as Job | null;
}

async function markDone(jobId: string) {
  const supabase = createAdminClient();
  await supabase
    .from("jobs")
    .update({ status: "done", locked_at: null, locked_by: null })
    .eq("id", jobId);
}

async function markFailedOrRetry(job: Job, err: unknown) {
  const supabase = createAdminClient();
  const msg = err instanceof Error ? err.message : String(err);
  const isTerminal = job.attempts >= job.max_attempts;
  if (isTerminal) {
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        locked_at: null,
        locked_by: null,
        last_error: msg,
      })
      .eq("id", job.id);
  } else {
    const backoffMs = Math.min(60_000 * 2 ** job.attempts, 30 * 60_000);
    await supabase
      .from("jobs")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        last_error: msg,
        run_at: new Date(Date.now() + backoffMs).toISOString(),
      })
      .eq("id", job.id);
  }
}

export type DrainResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

/**
 * Drain up to `maxJobs` jobs, or until `maxMs` milliseconds have elapsed.
 * Returns a small summary for logging.
 */
export async function drainJobs(opts: {
  maxJobs: number;
  maxMs: number;
}): Promise<DrainResult> {
  const deadline = Date.now() + opts.maxMs;
  const result: DrainResult = { processed: 0, succeeded: 0, failed: 0 };

  while (result.processed < opts.maxJobs && Date.now() < deadline) {
    const job = await claimNextJob();
    if (!job) break;
    result.processed++;
    try {
      const handler = handlers[job.type as JobType] as (
        payload: unknown
      ) => Promise<void>;
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job.payload);
      await markDone(job.id);
      result.succeeded++;
    } catch (err) {
      await markFailedOrRetry(job, err);
      result.failed++;
    }
  }
  return result;
}

export async function tick(): Promise<{
  drained: DrainResult;
}> {
  await sweepStuckJobs();
  await enqueueDeadlineClosures();
  const drained = await drainJobs({ maxJobs: 20, maxMs: 250_000 });
  return { drained };
}
