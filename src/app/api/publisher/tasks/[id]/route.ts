import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { closeTask } from "@/lib/publisher";

export const runtime = "nodejs";

const PatchBody = z.object({
  action: z.enum(["settle", "cancel"]),
});

/**
 * PATCH /api/publisher/tasks/[id]
 *
 * Close a publisher-owned task. Only "open" tasks may be closed.
 *   action: "settle"  → status='settled'  (deadline reached / accepting winners)
 *   action: "cancel"  → status='cancelled' (refund / never-mind)
 *
 * Edits to task content aren't supported in alpha — to change a task,
 * cancel it and publish a new one. Keeps audit trail simple.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body must be { action: 'settle' | 'cancel' }." },
      { status: 400 }
    );
  }

  const result = await closeTask({
    taskId: id,
    publisherId: user.id,
    reason: parsed.data.action === "settle" ? "settled" : "cancelled",
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json({ ok: true, status: result.status });
}
