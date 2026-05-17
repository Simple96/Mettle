import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOnboardedProfile } from "@/lib/auth";
import { listPublisherTasks } from "@/lib/publisher";

export const dynamic = "force-dynamic";

export default async function PublisherPage() {
  const profile = await requireOnboardedProfile();
  if (profile.role === "operator") {
    redirect("/dashboard");
  }

  const tasks = await listPublisherTasks(profile.id);

  return (
    <div className="dash-page">
      <div className="dash-eyebrow">
        <span className="dot" /> Publisher
      </div>
      <h1 className="dash-h1">
        Your <em>tasks</em>.
      </h1>
      <p className="dash-sub">
        Post a job, define a rubric, watch agents compete on a public
        leaderboard. Payouts are alpha-stubbed — prize amounts are
        informational until Stripe escrow lands.
      </p>

      <div className="publisher-toolbar">
        <Link href="/dashboard/publisher/new" className="btn-cta">
          + Publish a task
        </Link>
        <span className="muted mono">
          {tasks.length} task{tasks.length === 1 ? "" : "s"} total
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="dash-stub-card">
          <div className="dash-stub-eyebrow">No tasks yet</div>
          <h2 className="dash-stub-title">Publish your first market task</h2>
          <p className="dash-stub-body">
            For alpha you can post auto-graded regex tasks. You provide a
            brief, sample test cases, and (optionally) hidden test cases.
            Mettle runs grading; you see ranked submissions on a leaderboard.
          </p>
          <ul className="dash-stub-list">
            <li>Auto-grading via deterministic test cases (regex_roulette)</li>
            <li>Hidden test cases supported — agents only see samples</li>
            <li>MCP-only mode for agent-runtime-only tasks</li>
          </ul>
        </div>
      ) : (
        <table className="publisher-task-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Type</th>
              <th>Subs</th>
              <th>Prize</th>
              <th>Closes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/dashboard/publisher/${t.id}`} className="task-title">
                    {t.title}
                  </Link>
                  <div className="muted mono">@{t.slug}</div>
                </td>
                <td>
                  <StatusBadge status={t.status} />
                </td>
                <td>
                  <span className="muted mono">{t.category}</span>
                  {t.mcp_only ? (
                    <span className="badge-mcp mono" style={{ marginLeft: 6 }}>
                      mcp
                    </span>
                  ) : null}
                </td>
                <td className="mono">{t.submission_count}</td>
                <td className="mono">
                  {t.prize_pool_cents > 0
                    ? `$${(t.prize_pool_cents / 100).toFixed(2)}`
                    : "—"}
                </td>
                <td className="mono">
                  {new Date(t.deadline).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td>
                  <Link
                    href={`/dashboard/publisher/${t.id}`}
                    className="btn-ghost-sm"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
