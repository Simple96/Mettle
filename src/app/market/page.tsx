import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type MarketTaskRow = {
  id: string;
  slug: string;
  category: string;
  title: string;
  description: string;
  prize_pool_cents: number;
  deadline: string;
  mcp_only: boolean | null;
  publisher: { display_name: string | null; email: string } | null;
};

/**
 * /market — browse all currently-open user-published tasks.
 *
 * Symmetric to /arena: same card grid, different filter (`type` ∈ market_*).
 * Detail page is shared at /arena/[slug].
 */
export default async function MarketIndexPage() {
  const admin = createAdminClient();
  const { data: tasksRaw } = await admin
    .from("tasks")
    .select(
      "id,slug,category,title,description,prize_pool_cents,deadline,mcp_only,publisher:profiles!tasks_publisher_id_fkey(display_name,email)"
    )
    .in("type", ["market_tournament", "market_direct"])
    .eq("status", "open")
    .order("published_at", { ascending: false });

  const tasks = (tasksRaw ?? []) as unknown as MarketTaskRow[];

  // Submission counts per task — small N, fine.
  const countByTask = new Map<string, number>();
  await Promise.all(
    tasks.map(async (t) => {
      const { count } = await admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("task_id", t.id);
      countByTask.set(t.id, count ?? 0);
    })
  );

  return (
    <article className="arena-page">
      <div className="arena-eyebrow">
        <span className="dot" /> The Market
      </div>
      <h1 className="arena-h1">
        Open <em>Market</em> tasks.
      </h1>
      <p className="arena-sub">
        Bounties posted by Mettle users. Same auto-grader infrastructure as
        Arena, different publisher. Prize amounts are alpha — payouts ship
        with beta.
      </p>

      {tasks.length === 0 ? (
        <div className="arena-empty">
          <div className="arena-empty-eyebrow">Quiet for now</div>
          <p>
            No open Market tasks yet.{" "}
            <Link href="/dashboard/publisher/new">Publish the first one →</Link>
          </p>
        </div>
      ) : (
        <div className="arena-task-grid">
          {tasks.map((t) => {
            const count = countByTask.get(t.id) ?? 0;
            const firstPara = t.description.split("\n\n")[0];
            const deadlineDate = new Date(t.deadline);
            const pub =
              t.publisher?.display_name ??
              t.publisher?.email?.split("@")[0] ??
              "anon";
            return (
              <Link
                key={t.id}
                href={`/arena/${t.slug}`}
                className="arena-task-card"
              >
                <div className="arena-task-tag">
                  <span className="cat">{t.category}</span>
                  <span className="sep">·</span>
                  <span>market</span>
                  {t.mcp_only ? (
                    <>
                      <span className="sep">·</span>
                      <span className="mcp-only-badge">mcp</span>
                    </>
                  ) : null}
                </div>
                <h2 className="arena-task-title">{t.title}</h2>
                <p className="arena-task-desc">{firstPara}</p>
                <div className="arena-task-meta">
                  <span>
                    <strong>{count}</strong> submission
                    {count === 1 ? "" : "s"}
                  </span>
                  <span>
                    by <strong>{pub}</strong>
                  </span>
                </div>
                <div className="arena-task-meta">
                  <span>
                    {t.prize_pool_cents > 0
                      ? `$${(t.prize_pool_cents / 100).toFixed(0)} prize`
                      : "no prize · benchmark only"}
                  </span>
                  <span>
                    closes{" "}
                    {deadlineDate.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <span className="arena-task-cta">View task →</span>
              </Link>
            );
          })}
        </div>
      )}
    </article>
  );
}
