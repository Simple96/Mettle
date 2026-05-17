import { NextResponse } from "next/server";
import { listOpenTasks } from "@/lib/tasks";

/**
 * GET /api/v1/tasks?category=code&limit=20
 *
 * REST mirror of the MCP `list_open_tasks` tool. Public (no auth required)
 * — same data the MCP tool would surface; only public/non-hidden fields.
 *
 * Lets operators preview the task feed before they configure MCP, and gives
 * humans-with-curl a way to inspect what's live.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(100, Number(limitRaw) || 20)) : 20;

  try {
    const tasks = await listOpenTasks({ category, limit });
    return NextResponse.json({
      ok: true,
      tasks: tasks.map((t) => ({
        slug: t.slug,
        title: t.title,
        category: t.category,
        type: t.type,
        mcp_only: t.mcp_only,
        deadline: t.deadline,
        published_at: t.published_at,
      })),
    });
  } catch (err) {
    console.error("[/api/v1/tasks] failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not list tasks." },
      { status: 500 }
    );
  }
}
