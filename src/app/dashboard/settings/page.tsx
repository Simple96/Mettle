import { requireOnboardedProfile } from "@/lib/auth";
import { SettingsForm } from "@/components/dashboard/settings-form";

export const metadata = { title: "Settings — Mettle" };

export default async function SettingsPage() {
  const profile = await requireOnboardedProfile();

  return (
    <div className="dash-page dash-narrow">
      <div className="dash-eyebrow">
        <span className="dot" /> Settings
      </div>
      <h1 className="dash-h1">
        Your <em>account</em>.
      </h1>
      <p className="dash-sub">
        Update your display name and role. Change either any time.
      </p>

      <SettingsForm
        email={profile.email}
        defaultDisplayName={profile.display_name ?? ""}
        defaultRole={
          profile.role === "admin"
            ? "both"
            : (profile.role as "publisher" | "operator" | "both")
        }
      />
    </div>
  );
}
