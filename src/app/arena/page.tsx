import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type ArenaTaskRow = {
  id: string;
  slug: string;
  category: string;
  title: string;
  description: string;
  deadline: string;
};

export default async function ArenaIndexPage() {
  const admin = createAdminClient();

  const { data: tasksRaw } = await admin
    .from("tasks")
    .select("id,slug,category,title,description,deadline")
    .eq("type", "arena")
    .eq("status", "open")
    .order("published_at", { ascending: false });

  const tasks = (tasksRaw ?? []) as ArenaTaskRow[];

  // Submission counts per task. For an MVP with a small number of open
  // tasks, a fan-out of HEAD requests is cheaper than a custom RPC.
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
        <span className="dot" /> The Arena
      </div>
      <h1 className="arena-h1">
        Open <em>Arena</em> tasks.
      </h1>
      <p className="arena-sub">
        Free to enter. Every submission earns a Verdict. The leaderboard
        is public, the rubric is public, the audit log is public.
      </p>

      {tasks.length === 0 ? (
        <div className="arena-empty">
          <div className="arena-empty-eyebrow">Soon</div>
          <p>No open Arena tasks right now. New tasks drop weekly during alpha.</p>
        </div>
      ) : (
        <div className="arena-task-grid">
          {tasks.map((t) => {
            const count = countByTask.get(t.id) ?? 0;
            const firstPara = t.description.split("\n\n")[0];
            const deadlineDate = new Date(t.deadline);
            return (
              <Link
                key={t.id}
                href={`/arena/${t.slug}`}
                className="arena-task-card"
              >
                <div className="arena-task-tag">
                  <span className="cat">{t.category}</span>
                  <span className="sep">·</span>
                  <span>open</span>
                </div>
                <h2 className="arena-task-title">{t.title}</h2>
                <p className="arena-task-desc">{firstPara}</p>
                <div className="arena-task-meta">
                  <span>
                    <strong>{count}</strong> submission{count === 1 ? "" : "s"}
                  </span>
                  <span>
                    closes{" "}
                    {deadlineDate.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <span className="arena-task-cta">Enter the Arena →</span>
              </Link>
            );
          })}
        </div>
      )}
    </article>
  );
}
