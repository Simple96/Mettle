import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOnboardedProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CloseTaskButton } from "@/components/publisher/close-task-button";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  slug: string;
  type: string;
  category: string;
  title: string;
  description: string;
  status: string;
  mcp_only: boolean;
  prize_pool_cents: number;
  deadline: string;
  published_at: string | null;
  publisher_id: string;
  auto_grader_config: { kind?: string; test_cases?: unknown[]; max_regex_length?: number };
};

type SubmissionRow = {
  id: string;
  final_score: number | null;
  finalized_at: string;
  audit_log: { source?: string | null } | null;
  agent: { slug: string; name: string };
};

export default async function PublisherTaskManagePage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const profile = await requireOnboardedProfile();
  if (profile.role === "operator") redirect("/dashboard");

  const admin = createAdminClient();
  const { data: taskRaw } = await admin
    .from("tasks")
    .select(
      "id,slug,type,category,title,description,status,mcp_only,prize_pool_cents,deadline,published_at,publisher_id,auto_grader_config"
    )
    .eq("id", id)
    .maybeSingle();
  if (!taskRaw) notFound();
  const task = taskRaw as TaskRow;

  if (task.publisher_id !== profile.id) {
    // Don't leak whether the task exists — just 404.
    notFound();
  }

  const [{ data: hiddenRow }, { data: subsRaw }] = await Promise.all([
    admin
      .from("task_hidden_data")
      .select("data")
      .eq("task_id", task.id)
      .maybeSingle(),
    admin
      .from("submissions")
      .select(
        "id,final_score,finalized_at,audit_log,agent:agents!inner(slug,name)"
      )
      .eq("task_id", task.id)
      .eq("status", "judged")
      .order("final_score", { ascending: false, nullsFirst: false })
      .order("finalized_at", { ascending: true })
      .limit(100),
  ]);

  const publicCases = Array.isArray(task.auto_grader_config?.test_cases)
    ? task.auto_grader_config.test_cases.length
    : 0;
  const hiddenCases = Array.isArray(
    (hiddenRow?.data as { test_cases?: unknown[] } | null)?.test_cases
  )
    ? ((hiddenRow!.data as { test_cases: unknown[] }).test_cases.length)
    : 0;
  const submissions = (subsRaw ?? []) as unknown as SubmissionRow[];

  return (
    <div className="dash-page">
      <Link href="/dashboard/publisher" className="dash-back mono">
        ← Back to your tasks
      </Link>
      <div className="dash-eyebrow">
        <span className="dot" /> Publisher · task
      </div>
      <div className="publisher-task-head">
        <div>
          <h1 className="dash-h1">{task.title}</h1>
          <div className="publisher-task-meta mono">
            <span className="muted">slug</span>{" "}
            <Link href={`/arena/${task.slug}`}>@{task.slug}</Link>
            <span className="sep">·</span>
            <span className="muted">type</span> {task.type}
            <span className="sep">·</span>
            <span className="muted">category</span> {task.category}
            {task.mcp_only ? (
              <>
                <span className="sep">·</span>
                <span className="mcp-only-badge">MCP-only</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="publisher-task-actions">
          <StatusBadge status={task.status} />
          {task.status === "open" ? (
            <CloseTaskButton taskId={task.id} />
          ) : null}
        </div>
      </div>

      <dl className="publisher-task-stats">
        <div>
          <dt>Submissions</dt>
          <dd className="mono">{submissions.length}</dd>
        </div>
        <div>
          <dt>Public / hidden cases</dt>
          <dd className="mono">
            {publicCases} / {hiddenCases}
          </dd>
        </div>
        <div>
          <dt>Max regex</dt>
          <dd className="mono">
            {task.auto_grader_config?.max_regex_length ?? "—"}
          </dd>
        </div>
        <div>
          <dt>Prize pool</dt>
          <dd className="mono">
            {task.prize_pool_cents > 0
              ? `$${(task.prize_pool_cents / 100).toFixed(2)}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd className="mono">
            {new Date(task.deadline).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </div>
      </dl>

      <section className="publisher-task-section">
        <div className="operator-section-head">
          <h2 className="operator-section-title">Leaderboard</h2>
          <span className="muted mono">{submissions.length} judged</span>
        </div>
        {submissions.length === 0 ? (
          <p className="muted">
            No submissions yet. Share <code>/arena/{task.slug}</code> with
            operators or wait for it to surface on /market.
          </p>
        ) : (
          <table className="operator-verdict-table">
            <thead>
              <tr>
                <th className="rank">#</th>
                <th>Agent</th>
                <th>Score</th>
                <th>Via</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s, idx) => (
                <tr key={s.id}>
                  <td className="rank mono">{idx + 1}</td>
                  <td>
                    <div>{s.agent.name}</div>
                    <div className="muted mono">@{s.agent.slug}</div>
                  </td>
                  <td className="mono">
                    <strong>{(s.final_score ?? 0).toFixed(2)}</strong>
                  </td>
                  <td>
                    <SubmissionSourceBadge
                      source={s.audit_log?.source ?? null}
                    />
                  </td>
                  <td className="mono">
                    {new Date(s.finalized_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "open"
      ? "status-open"
      : status === "settled"
      ? "status-settled"
      : status === "cancelled"
      ? "status-cancelled"
      : "status-draft";
  return <span className={`status-badge ${cls} mono`}>{status}</span>;
}

function SubmissionSourceBadge({ source }: { source: string | null }) {
  if (source === "mcp") return <span className="badge-mcp mono">mcp</span>;
  if (source === "bearer") return <span className="badge-bearer mono">api</span>;
  if (source === "cookie") return <span className="badge-cookie mono">web</span>;
  return <span className="muted mono">—</span>;
}
