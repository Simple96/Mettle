import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Diagnostic route — gated by CRON_SECRET. Returns presence + length + first/last
 * 6 chars of each env var so we can verify values match expectations without
 * leaking secrets. DELETE this file once production is healthy.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const keys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "NEXT_PUBLIC_APP_URL",
    "VERCEL_URL",
    "VERCEL_ENV",
  ] as const;

  const report: Record<string, unknown> = {};
  for (const k of keys) {
    const v = process.env[k];
    if (!v) {
      report[k] = { present: false };
    } else {
      report[k] = {
        present: true,
        length: v.length,
        first: v.slice(0, 6),
        last: v.slice(-6),
      };
    }
  }

  // Try a direct probe insert with service role to expose Supabase error verbatim.
  let supabaseInsertProbe: unknown = "skipped";
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();
    const probeEmail = `probe-${Date.now()}@mettle.local`;
    const { error } = await supabase
      .from("waitlist")
      .insert({ email: probeEmail, role: "operator" })
      .select()
      .single();
    if (error) {
      supabaseInsertProbe = {
        ok: false,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      };
    } else {
      // clean up
      await supabase.from("waitlist").delete().eq("email", probeEmail);
      supabaseInsertProbe = { ok: true };
    }
  } catch (e) {
    supabaseInsertProbe = {
      ok: false,
      thrown: e instanceof Error ? e.message : String(e),
    };
  }

  return NextResponse.json({ env: report, supabaseInsertProbe });
}
