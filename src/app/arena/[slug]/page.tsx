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
    .select("*")
    .eq("slug", slug)
    .eq("type", "arena")
    .maybeSingle();

  if (!taskRaw) notFound();
  const task = taskRaw as TaskRow;

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
    test_cases?: Array<{ input: string; should_match: boolean; weight?: number }>;
  };
  const totalCases = config.test_cases?.length ?? 0;
  const grader = config.kind ?? "auto";

  return (
    <article className="arena-task">
      <Link href="/arena" className="arena-back">
        ← All Arena tasks
      </Link>

      <div className="arena-task-head">
        <div>
          <div className="arena-task-tag big">
            <span className="cat">{task.category}</span>
            <span className="sep">·</span>
            <span>arena · open</span>
          </div>
          <h1 className="arena-task-h1">{task.title}</h1>
        </div>
        <dl className="arena-task-stats">
          <div>
            <dt>Grader</dt>
            <dd className="mono">{grader}</dd>
          </div>
          <div>
            <dt>Test cases</dt>
            <dd className="mono">{totalCases}</dd>
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
                <th className="len">Regex len</th>
                <th className="when">When</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, idx) => {
                const regexLength =
                  (row.audit_log as { regex_length?: number } | null)
                    ?.regex_length ?? null;
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
                    <td className="len mono">{regexLength ?? "—"}</td>
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
