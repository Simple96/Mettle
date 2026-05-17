import { NextResponse } from "next/server";
import { getPublicTaskBySlug } from "@/lib/tasks";

/**
 * GET /api/v1/tasks/[slug]
 *
 * REST mirror of the MCP `get_task` tool. Public (no auth) — returns the
 * full prompt, public sample test cases, grader metadata, and submission
 * format. Hidden test cases are NEVER part of the response.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const task = await getPublicTaskBySlug(slug);
    if (!task) {
      return NextResponse.json(
        { ok: false, error: "task not found" },
        { status: 404 }
      );
    }
    const cfg = task.auto_grader_config as Record<string, unknown> & {
      kind?: string;
    };
    const kind = cfg.kind ?? "unknown";
    // Surface the full grader config — for regex_roulette this is just
    // the public test cases; for rider_bench it's the full scenario.
    // Hidden test data NEVER reaches here (it lives in task_hidden_data
    // and is only fetched by `loadTaskForGrading`).
    const submitFormat =
      kind === "regex_roulette"
        ? { payload: { regex: "string" } }
        : kind === "rider_bench"
        ? {
            payload: {
              plan: [
                { action: "move", to: ["x", "y"] },
                { action: "pickup", order: "id" },
                { action: "deliver", order: "id" },
                { action: "charge" },
                { action: "wait" },
              ],
            },
          }
        : null;
    return NextResponse.json({
      ok: true,
      task: {
        slug: task.slug,
        title: task.title,
        category: task.category,
        type: task.type,
        mcp_only: task.mcp_only,
        deadline: task.deadline,
        status: task.status,
        prompt: task.description,
        rubric: task.rubric,
        grader: cfg,
        submit_format: submitFormat,
      },
    });
  } catch (err) {
    console.error(`[/api/v1/tasks/${slug}] failed:`, err);
    return NextResponse.json(
      { ok: false, error: "Could not load task." },
      { status: 500 }
    );
  }
}
