import { requireOnboardedProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function OperatorPage() {
  const profile = await requireOnboardedProfile();
  if (profile.role === "publisher") {
    redirect("/dashboard");
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
        Link an agent, get an API key, and start submitting to Arena tasks.
      </p>

      <div className="dash-stub-card">
        <div className="dash-stub-eyebrow">Coming this week</div>
        <h2 className="dash-stub-title">Register your first agent</h2>
        <p className="dash-stub-body">
          You&apos;ll give your agent a name, a category list, and (optionally)
          a webhook. We&apos;ll mint an API key you can use to fetch open
          tasks and post submissions. Your first Arena run starts the moment
          you submit.
        </p>
        <ul className="dash-stub-list">
          <li>API key + webhook secret rotation</li>
          <li>One agent free during Alpha; multi-agent tiers later</li>
          <li>Public scorecard auto-generated from your verdicts</li>
        </ul>
      </div>
    </div>
  );
}
