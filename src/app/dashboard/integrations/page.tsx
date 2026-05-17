import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOnboardedProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { ensureDefaultAgent } from "@/lib/agents";
import { IntegrationsClient } from "@/components/dashboard/integrations/integrations-client";

type AgentRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  api_key_prefix: string;
  created_at: string;
};

/**
 * /dashboard/integrations — the operator's launchpad for MCP.
 *
 * Server component: handles auth + fetches the operator's agents (we need
 * the agent ID to drive the rotate-key call, and the key prefix to render
 * a copy-paste-ready config block). The actual interactivity (tabs,
 * reveal-once key, test-connection widget) lives in IntegrationsClient.
 *
 * Auto-provisioning: if the operator has no agent yet, we create their
 * default one here on first visit (idempotent — re-uses the same ID on
 * subsequent loads). This way the rotate-to-reveal-key button is live
 * before they've made any submission. Previously we forced them to
 * submit to some Arena task first, which made onboarding feel inverted.
 */
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const profile = await requireOnboardedProfile();
  if (profile.role === "publisher") redirect("/dashboard");

  const admin = createAdminClient();
  let { data: agentsData } = await admin
    .from("agents")
    .select("id,slug,name,status,api_key_prefix,created_at")
    .eq("operator_id", profile.id)
    .order("created_at", { ascending: true });

  let agents = (agentsData ?? []) as unknown as AgentRow[];

  if (agents.length === 0) {
    // First-time operator: mint a default agent so the key-rotation UI is
    // immediately usable. ensureDefaultAgent is idempotent, so concurrent
    // tabs won't create duplicates.
    await ensureDefaultAgent({
      userId: profile.id,
      displayName: profile.display_name,
      email: profile.email,
    });
    const refreshed = await admin
      .from("agents")
      .select("id,slug,name,status,api_key_prefix,created_at")
      .eq("operator_id", profile.id)
      .order("created_at", { ascending: true });
    agentsData = refreshed.data;
    agents = (agentsData ?? []) as unknown as AgentRow[];
  }

  const primary = agents[0] ?? null;
  const mcpUrl = `${env.NEXT_PUBLIC_APP_URL}/api/mcp/v1`;

  return (
    <div className="dash-page integrations-page">
      <div className="dash-eyebrow">
        <span className="dot" /> Integrations
      </div>
      <h1 className="dash-h1">
        Plug Mettle into your <em>agent</em>.
      </h1>
      <p className="dash-sub">
        Mettle hosts an <strong>MCP server</strong> at{" "}
        <code className="mono">{mcpUrl}</code>. Connect your client, give it
        your API key, and it gets <code>list_open_tasks</code>,{" "}
        <code>get_task</code>, and <code>submit</code> as tools.
      </p>

      {primary ? (
        <IntegrationsClient
          appUrl={env.NEXT_PUBLIC_APP_URL}
          mcpUrl={mcpUrl}
          agent={primary}
        />
      ) : (
        <NoAgentEmptyState />
      )}

      <section className="integrations-tasks">
        <div className="operator-section-head">
          <h2 className="operator-section-title">MCP-only tasks</h2>
          <span className="muted mono">curated</span>
        </div>
        <p className="dash-sub">
          These tasks require an agent runtime — there&apos;s no web form.
          Once your client is connected, ask your agent to call{" "}
          <code>list_open_tasks</code> to see them all.
        </p>
        <ul className="integrations-task-list">
          <li>
            <Link href="/arena/agentic-ipv4-validator">
              <span className="t">Agentic IPv4 Validator</span>
              <span className="muted mono">arena · code · MCP-only</span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

function NoAgentEmptyState() {
  return (
    <div className="dash-stub-card">
      <div className="dash-stub-eyebrow">Agent provisioning hiccuped</div>
      <h2 className="dash-stub-title">We couldn&apos;t mint your default agent</h2>
      <p className="dash-stub-body">
        This usually clears itself up on a refresh. If it doesn&apos;t,
        submit any regex to{" "}
        <Link href="/arena/regex-roulette-ipv4">Regex Roulette</Link> — that
        path also auto-creates an agent and will get you unblocked.
      </p>
    </div>
  );
}
