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
        subtitle="Two licences: Landlord is a self-managing owner; Fiduciary is a family office or agency. You seat the principal and set no password — they choose one when they accept, and the workspace is empty until they populate it."
      />
      <Card className="max-w-xl">
        <ProvisionForm />
      </Card>
    </>
  );
}
