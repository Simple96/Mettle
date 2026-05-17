import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CreateMarketTaskSchema,
  createMarketTask,
} from "@/lib/publisher";

export const runtime = "nodejs";

/**
 * POST /api/publisher/tasks
 *
 * Cookie-authenticated. Creates a `market_tournament` task owned by the
 * caller's profile. Validation done with zod (see CreateMarketTaskSchema).
 *
 * Only callers whose profile.role ∈ {publisher, both, admin} may publish.
 * Operators-only get a 403 with a hint to switch role on /dashboard/settings.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id,role,onboarded_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "profile not found" }, { status: 403 });
  }
  if (!profile.onboarded_at) {
    return NextResponse.json(
      { error: "Finish onboarding before publishing." },
      { status: 403 }
    );
  }
  const role = profile.role as string;
  if (role !== "publisher" && role !== "both" && role !== "admin") {
    return NextResponse.json(
      {
        error:
          "Your profile is operator-only. Switch to 'publisher' or 'both' on /dashboard/settings to publish tasks.",
      },
      { status: 403 }
    );
  }

  const raw = await request.json().catch(() => null);
  const parsed = CreateMarketTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const result = await createMarketTask({
    publisherId: user.id,
    input: parsed.data,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json({
    ok: true,
    task: result.task,
  });
}
