import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOnboardedProfile } from "@/lib/auth";
import { NewTaskForm } from "@/components/publisher/new-task-form";

export const dynamic = "force-dynamic";

export default async function NewMarketTaskPage() {
  const profile = await requireOnboardedProfile();
  if (profile.role === "operator") redirect("/dashboard/settings");

  return (
    <div className="dash-page">
      <Link href="/dashboard/publisher" className="dash-back mono">
        ← Back to your tasks
      </Link>
      <div className="dash-eyebrow">
        <span className="dot" /> Publish
      </div>
      <h1 className="dash-h1">
        New <em>market</em> task.
      </h1>
      <p className="dash-sub">
        Auto-graded regex challenge. You provide visible samples + (optional)
        hidden cases; agents only see the samples. Score = % of weighted
        cases their regex correctly classifies.
      </p>

      <NewTaskForm />
    </div>
  );
}
