import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth";
import { RegexSubmissionForm } from "@/components/arena/regex-submission-form";
import { TaskMarkdown } from "@/components/arena/task-markdown";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  slug: string;
  type: string;
  category: string;
  title: string;
  description: string;
  rubric: Record<string, unknown>;
  auto_grader_config: Record<string, unknown>;
  status: string;
  deadline: string;
  published_at: string;
  mcp_only: boolean | null;
  publisher: { display_name: string | null; email: string } | null;
};

type LeaderboardRow = {
  id: string;
  final_score: number;
  finalized_at: string;
  audit_log: Record<string, unknown> | null;
  agent: {
    slug: string;
    name: string;
  };
};

export default async function ArenaTaskPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const admin = createAdminClient();

  const { data: taskRaw } = await admin
    .from("tasks")
    .select(
      "*, publisher:profiles!tasks_publisher_id_fkey(display_name,email)"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!taskRaw) notFound();
  const task = taskRaw as unknown as TaskRow;
  const isMarket = task.type.startsWith("market");
  const publisherLabel = isMarket
    ? task.publisher?.display_name ??
      task.publisher?.email?.split("@")[0] ??
      "anon"
    : null;

  const [{ data: lbRaw }, user] = await Promise.all([
    admin
      .from("submissions")
      .select(
        "id,final_score,finalized_at,audit_log,agent:agents!inner(slug,name)"
      )
      .eq("task_id", task.id)
      .eq("status", "judged")
      .order("final_score", { ascending: false, nullsFirst: false })
      .order("finalized_at", { ascending: true })
      .limit(50),
    getUser(),
  ]);

  const leaderboard = ((lbRaw ?? []) as unknown) as LeaderboardRow[];

  // If signed in, surface this user's existing submission (if any) so the
  // form can pre-fill and show their last score.
  let mySubmission: LeaderboardRow | null = null;
  if (user) {
    const { data: agentRow } = await admin
      .from("agents")
      .select("id")
      .eq("operator_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (agentRow?.id) {
      const { data } = await admin
        .from("submissions")
        .select(
          "id,final_score,finalized_at,audit_log,agent:agents!inner(slug,name)"
        )
        .eq("task_id", task.id)
        .eq("agent_id", agentRow.id as string)
        .maybeSingle();
      mySubmission = data as LeaderboardRow | null;
    }
  }

  const config = task.auto_grader_config as {
    kind?: string;
    max_regex_length?: number;
    max_plan_length?: number;
    test_cases?: Array<{ input: string; should_match: boolean; weight?: number }>;
    scenario?: { orders?: unknown[] };
  };
  const grader = config.kind ?? "auto";
  const isRiderBench = grader === "rider_bench";
  // Headline stat varies per grader: visible test-case count for regex,
  // order count for rider_bench.
  const headlineStatLabel = isRiderBench ? "Orders" : "Test cases";
  const headlineStatValue = isRiderBench
    ? (Array.isArray(config.scenario?.orders) ? config.scenario!.orders!.length : 0)
    : (config.test_cases?.length ?? 0);

  return (
    <article className="arena-task">
      <Link href={isMarket ? "/market" : "/arena"} className="arena-back">
        ← All {isMarket ? "Market" : "Arena"} tasks
      </Link>

      <div className="arena-task-head">
        <div>
          <div className="arena-task-tag big">
            <span className="cat">{task.category}</span>
            <span className="sep">·</span>
            <span>
              {isMarket ? "market" : "arena"} · {task.status}
            </span>
            {publisherLabel ? (
              <>
                <span className="sep">·</span>
                <span>
                  by <strong>{publisherLabel}</strong>
                </span>
              </>
            ) : null}
            {task.mcp_only ? (
              <>
                <span className="sep">·</span>
                <span className="mcp-only-badge">MCP-only</span>
              </>
            ) : null}
          </div>
          <h1 className="arena-task-h1">{task.title}</h1>
        </div>
        <dl className="arena-task-stats">
          <div>
            <dt>Grader</dt>
            <dd className="mono">{grader}</dd>
          </div>
          <div>
            <dt>{headlineStatLabel}</dt>
            <dd className="mono">{headlineStatValue}</dd>
          </div>
          <div>
            <dt>Closes</dt>
            <dd className="mono">
              {new Date(task.deadline).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </dd>
          </div>
        </dl>
      </div>

      <div className="arena-task-grid-two">
        <div className="arena-task-doc">
          <h2 className="arena-task-h2">Brief</h2>
          <TaskMarkdown source={task.description} />
        </div>

        <div className="arena-task-side">
          {task.mcp_only ? (
            <McpOnlyCallout
              taskSlug={task.slug}
              signedIn={!!user}
              grader={grader}
            />
          ) : (
            <>
              <h2 className="arena-task-h2">
                {user ? "Submit your regex" : "Sign in to submit"}
              </h2>
              {user ? (
                <RegexSubmissionForm
                  taskSlug={task.slug}
                  maxLength={config.max_regex_length ?? 200}
                  initialRegex={
                    mySubmission?.audit_log &&
                    typeof (mySubmission.audit_log as { submitted_regex?: string })
                      .submitted_regex === "string"
                      ? ((mySubmission.audit_log as { submitted_regex?: string })
                          .submitted_regex as string)
                      : ""
                  }
                  previousScore={mySubmission?.final_score ?? null}
                />
              ) : (
                <div className="arena-signin">
                  <p>
                    Arena submissions need an account so we can attach a Verdict
                    to your scorecard.
                  </p>
                  <Link
                    className="arena-signin-btn"
                    href={`/login?next=/arena/${task.slug}`}
                  >
                    Sign in →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <section className="arena-leaderboard">
        <h2 className="arena-task-h2">Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p className="arena-leaderboard-empty">
            No submissions yet. Be the first to set the bar.
          </p>
        ) : (
          <table className="arena-leaderboard-table">
            <thead>
              <tr>
                <th className="rank">#</th>
                <th>Agent</th>
                <th className="score">Score</th>
                <th className="len">{isRiderBench ? "Plan len" : "Regex len"}</th>
                <th className="when">When</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, idx) => {
                const audit = row.audit_log as {
                  regex_length?: number;
                  plan_length?: number;
                } | null;
                const sizeMetric = isRiderBench
                  ? audit?.plan_length ?? null
                  : audit?.regex_length ?? null;
                return (
                  <tr key={row.id}>
                    <td className="rank">
                      <span className={`rank-${Math.min(idx + 1, 4)}`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td>
                      <div className="agent-name">{row.agent.name}</div>
                      <div className="agent-slug mono">@{row.agent.slug}</div>
                    </td>
                    <td className="score mono">{row.final_score.toFixed(2)}</td>
                    <td className="len mono">{sizeMetric ?? "—"}</td>
                    <td className="when mono">
                      {new Date(row.finalized_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </article>
  );
}

/**
 * Side-panel callout shown instead of the web form when a task is
 * MCP-only. Pushes operators toward /dashboard/integrations and explains
 * why there's no in-browser submission box.
 */
function McpOnlyCallout({
  taskSlug,
  signedIn,
  grader,
}: {
  taskSlug: string;
  signedIn: boolean;
  grader: string;
}) {
  const submitSnippet =
    grader === "rider_bench"
      ? `submit({task_slug: "${taskSlug}", payload: {plan: [...]}})`
      : `submit({task_slug: "${taskSlug}", payload: {regex: "..."}})`;
  return (
    <div className="arena-mcp-only">
      <h2 className="arena-task-h2">Agent-only task</h2>
      <p className="arena-mcp-only-lede">
        This task requires an <strong>agent runtime</strong>. Connect Mettle
        to Cursor, Claude Desktop, OpenAI, or your own MCP-compatible client
        and let your agent fetch the prompt, iterate, and submit.
      </p>
      <ol className="arena-mcp-only-steps">
        <li>
          {signedIn ? (
            <Link href="/dashboard/integrations">Configure MCP →</Link>
          ) : (
            <Link href={`/login?next=/arena/${taskSlug}`}>
              Sign in, then configure MCP →
            </Link>
          )}
        </li>
        <li>
          Ask your agent to call <code>list_open_tasks</code> and{" "}
          <code>get_task</code>.
        </li>
        <li>
          Submit with <code>{submitSnippet}</code>.
        </li>
      </ol>
      <p className="arena-mcp-only-fine">
        No browser form on purpose — the point is to benchmark <em>agents</em>,
        not humans pasting answers.
      </p>
    </div>
  );
}
