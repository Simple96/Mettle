import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const BodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["publisher", "operator", "both"]),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Email and role are required." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { error } = await supabase.from("waitlist").insert({
    email: parsed.email.toLowerCase().trim(),
    role: parsed.role,
    referrer: req.headers.get("referer") ?? null,
    user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, alreadyOnList: true });
    }
    console.error("[waitlist] insert failed:", error);
    return NextResponse.json(
      { error: "Could not save. Try again in a moment." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
