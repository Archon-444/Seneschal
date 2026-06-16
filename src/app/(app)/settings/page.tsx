import { requireCtx } from "@/server/auth/request";
import { getMyProfile } from "@/server/services/profile";
import { getMyNotificationPreferences } from "@/server/services/notifications";
import { Button, Card, Field, PageHeader, inputClass } from "@/components/ui";
import { updateNotificationPrefsAction, updateProfileAction } from "./actions";

const CATEGORY_LABEL: Record<string, string> = {
  DEADLINES: "Deadlines & notice gates",
  PAYMENTS: "Payments & cheques",
  RENEWALS: "Renewals",
  PROOFS: "Proof requests",
  RISK: "Risk flags",
  DIGEST: "Weekly portfolio summary",
};

const CADENCES = ["IMMEDIATE", "DAILY", "WEEKLY", "OFF"] as const;
const CADENCE_LABEL: Record<string, string> = {
  IMMEDIATE: "Immediately",
  DAILY: "Daily digest",
  WEEKLY: "Weekly digest",
  OFF: "Off",
};

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const [profile, prefs] = await Promise.all([getMyProfile(ctx), getMyNotificationPreferences(ctx)]);

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" subtitle="Your profile and how Seneschal reaches you." />

      <div id="profile" className="mb-8 max-w-2xl scroll-mt-20">
        <h2 className="font-display mb-3 text-lg text-navy-900">Profile</h2>
        <Card>
          <form action={updateProfileAction} className="space-y-4">
            <Field label="Name">
              <input name="name" defaultValue={profile?.name ?? ""} className={inputClass} />
            </Field>
            <Field label="Email">
              <input value={profile?.email ?? ""} disabled className={`${inputClass} opacity-60`} />
            </Field>
            <Field label="Locale">
              <input name="locale" defaultValue={profile?.locale ?? ""} placeholder="en" className={inputClass} />
            </Field>
            <Button type="submit">Save profile</Button>
          </form>
        </Card>
      </div>

      <div id="notifications" className="max-w-2xl scroll-mt-20">
        <h2 className="font-display mb-1 text-lg text-navy-900">Notifications</h2>
        <p className="mb-3 text-sm text-muted">
          Choose how each kind of alert reaches your email. The in-app bell always shows everything. Critical events —
          a bounced cheque or the 72-hour notice window — are emailed immediately whatever you pick here.
        </p>
        <Card>
          <form action={updateNotificationPrefsAction} className="space-y-3">
            {prefs.map((p) => (
              <div
                key={p.category}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-40 flex-1">
                  <div className="text-sm font-medium text-navy-900">{CATEGORY_LABEL[p.category] ?? p.category}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" name={`inapp_${p.category}`} defaultChecked={p.inAppEnabled} />
                  In-app
                </label>
                <select name={`cadence_${p.category}`} defaultValue={p.cadence} className={`${inputClass} w-44`}>
                  {CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {CADENCE_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <Button type="submit">Save preferences</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
