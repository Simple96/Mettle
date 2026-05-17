import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  display_name: z.string().trim().min(1).max(48),
  role: z.enum(["publisher", "operator", "both"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Display name (1–48 chars) and a valid role are required." },
      { status: 400 }
    );
  }

  const { display_name, role } = parsed.data;

  // RLS policy `profiles_self_update` allows updating own row.
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name,
      role,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    console.error("[onboard] update failed:", error);
    return NextResponse.json({ error: "Could not save profile." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
