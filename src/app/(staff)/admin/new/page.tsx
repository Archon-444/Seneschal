import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/server/auth/request";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { ProvisionForm } from "./ProvisionForm";

// Provision workspace (F-Admin §7). Gated at the handler; no data tabs exist on this plane.
export default async function ProvisionPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect("/dashboard");
  }
  return (
    <>
      <BackLink href="/admin" label="Platform console" />
      <PageHeader
        title="Provision workspace"
        subtitle="Create a customer org and seat its principal. You set no credential — the principal sets their own on first login, and the workspace is empty until they populate it."
      />
      <Card className="max-w-xl">
        <ProvisionForm />
      </Card>
    </>
  );
}
