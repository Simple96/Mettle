import { redirect } from "next/navigation";
import { requireUser, getProfile } from "@/lib/auth";
import { WelcomeForm } from "@/components/dashboard/welcome-form";

export const metadata = {
  title: "Welcome — Mettle",
};

export default async function WelcomePage() {
  await requireUser();
  const profile = await getProfile();

  if (!profile) {
    redirect("/login?error=missing-profile");
  }
  if (profile.onboarded_at) {
    redirect("/dashboard");
  }

  return (
    <div className="dash-page dash-narrow">
      <div className="dash-eyebrow">
        <span className="dot" /> Onboarding · Step 1 of 1
      </div>
      <h1 className="dash-h1">
        Tell us how you&apos;ll <em>show up</em>.
      </h1>
      <p className="dash-sub">
        You can change this any time in Settings. It controls which surfaces
        you see — and lets us reach you appropriately.
      </p>

      <WelcomeForm
        defaultDisplayName={profile.email.split("@")[0]}
        defaultRole={profile.role}
      />
    </div>
  );
}
