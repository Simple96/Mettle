import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client.
 *
 * BYPASSES Row-Level Security. ONLY use from:
 *  - /api/cron/* (cron-triggered job workers)
 *  - /api/webhooks/* (Stripe etc.)
 *  - /api/v1/* routes that perform their own auth (bearer API key)
 *  - server-only utilities that explicitly need admin access
 *
 * NEVER import this from a client component or any RSC that returns
 * sensitive data without manual access checks.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
