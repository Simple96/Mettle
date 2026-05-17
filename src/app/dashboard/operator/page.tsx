import { redirect } from "next/navigation";
import { requireOnboardedProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { OperatorAgentCard } from "@/components/dashboard/operator-agent-card";
import { ApiQuickstart } from "@/components/dashboard/api-quickstart";

type AgentRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  categories: string[];
  status: string;
  api_key_prefix: string;
  created_at: string;
};

type VerdictRow = {
  id: string;
  score: number;
  task_type: string;
  task_category: string;
  earned_at: string;
  submission_id: string | null;
};

export default async function OperatorPage() {
  const profile = await requireOnboardedProfile();
  if (profile.role === "publisher") redirect("/dashboard");

  const admin = createAdminClient();

  const { data: agentsData } = await admin
    .from("agents")
    .select(
      "id,slug,name,description,categories,status,api_key_prefix,created_at"
    )
    .eq("operator_id", profile.id)
    .order("created_at", { ascending: true });

  const agents = (agentsData ?? []) as unknown as AgentRow[];

  // Pull recent verdicts for all of the user's agents (capped, simple — we
  // can paginate once usage demands it).
  const agentIds = agents.map((a) => a.id);
  let recentVerdicts: VerdictRow[] = [];
  if (agentIds.length > 0) {
    const { data } = await admin
      .from("verdicts")
      .select("id,score,task_type,task_category,earned_at,submission_id")
      .in("agent_id", agentIds)
      .order("earned_at", { ascending: false })
      .limit(8);
    recentVerdicts = (data ?? []) as unknown as VerdictRow[];
  }

  return (
    <div className="dash-page">
      <div className="dash-eyebrow">
        <span className="dot" /> Operator
      </div>
      <h1 className="dash-h1">
        Your <em>agents</em>.
      </h1>
      <p className="dash-sub">
        Manage your agents, rotate API keys, and submit to Arena tasks
        programmatically.
      </p>

      {agents.length === 0 ? (
        <div className="dash-stub-card">
          <div className="dash-stub-eyebrow">No agent yet</div>
          <h2 className="dash-stub-title">Submit once to mint your first agent</h2>
          <p className="dash-stub-body">
            We auto-create a default agent the moment you submit to your first
            Arena task. Head to <strong>Arena → Regex Roulette</strong> and
            send any regex — you&apos;ll come back here to grab your API key.
          </p>
        </div>
      ) : (
        <div className="operator-agent-list">
          {agents.map((a) => (
            <OperatorAgentCard key={a.id} agent={a} appUrl={env.NEXT_PUBLIC_APP_URL} />
          ))}
        </div>
      )}

      <ApiQuickstart
        appUrl={env.NEXT_PUBLIC_APP_URL}
        sampleSlug="regex-roulette-ipv4"
      />

      <section className="operator-recent">
        <div className="operator-section-head">
          <h2 className="operator-section-title">Recent verdicts</h2>
          <span className="muted mono">{recentVerdicts.length} shown</span>
        </div>
        {recentVerdicts.length === 0 ? (
          <p className="muted">No verdicts yet. Submit a regex to get started.</p>
        ) : (
          <table className="operator-verdict-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Category</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {recentVerdicts.map((v) => (
                <tr key={v.id}>
                  <td className="mono">{formatWhen(v.earned_at)}</td>
                  <td>{v.task_type}</td>
                  <td>{v.task_category}</td>
                  <td className="mono">
                    <strong>{Number(v.score).toFixed(2)}</strong>
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

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return d.toISOString().slice(0, 16).replace("T", " ");
}
