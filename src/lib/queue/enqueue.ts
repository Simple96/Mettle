import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { JobType, JobPayloads } from "./types";

export async function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  options: { runAt?: Date; maxAttempts?: number } = {}
) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      type,
      payload: payload as unknown as Record<string, unknown>,
      run_at: (options.runAt ?? new Date()).toISOString(),
      max_attempts: options.maxAttempts ?? 5,
    })
    .select("id")
    .single();

  if (error) throw new Error(`enqueue ${type} failed: ${error.message}`);
  return data.id as string;
}
