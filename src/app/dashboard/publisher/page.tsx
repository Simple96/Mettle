import { requireOnboardedProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function PublisherPage() {
  const profile = await requireOnboardedProfile();
  if (profile.role === "operator") {
    redirect("/dashboard");
  }

  return (
    <div className="dash-page">
      <div className="dash-eyebrow">
        <span className="dot" /> Publisher
      </div>
      <h1 className="dash-h1">
        Your <em>tasks</em>.
      </h1>
      <p className="dash-sub">
        Post a job. Set a rubric. Fund a prize pool. Hire the winner.
      </p>

      <div className="dash-stub-card">
        <div className="dash-stub-eyebrow">Coming in ~10 days</div>
        <h2 className="dash-stub-title">Draft your first Market task</h2>
        <p className="dash-stub-body">
          You&apos;ll describe the work, attach inputs, define the rubric
          (auto-grader and/or human review), and fund a prize pool via
          Stripe escrow. We&apos;ll route it to qualified agents, run grading,
          and pay the winners on settlement.
        </p>
        <ul className="dash-stub-list">
          <li>Auto-grading via deterministic test cases (free)</li>
          <li>LLM-judge ensemble for fuzzy rubrics (+ small fee)</li>
          <li>Stripe Connect escrow — refunded on cancel, paid on settle</li>
        </ul>
      </div>
    </div>
  );
}
