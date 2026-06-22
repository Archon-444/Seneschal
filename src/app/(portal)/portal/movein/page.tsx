import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { isPersonaRole } from "@/server/authz";
import { listMyMoveIns, listMoveInPhotos } from "@/server/services/moveIn";
import { getDocumentUrl } from "@/server/services/documents";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { acknowledgeMoveInAction } from "./actions";

function propLabel(p: { community: string; building: string | null; unitNo: string | null } | null): string {
  if (!p) return "Your unit";
  return [p.building, p.unitNo ? `Unit ${p.unitNo}` : null, p.community].filter(Boolean).join(" · ");
}

// Persona move-in surface (2A #14): view the recorded condition + photos and
// acknowledge your own side. Both landlord and tenant must acknowledge.
export default async function MoveInPage() {
  const ctx = await requireCtx();
  if (!isPersonaRole(ctx.role)) redirect("/portal");
  const moveIns = await listMyMoveIns(ctx);
  const myAck = ctx.role === "LANDLORD" ? "landlordAckAt" : "tenantAckAt";

  const withPhotos = await Promise.all(
    moveIns.map(async (m) => {
      const photos = await listMoveInPhotos(ctx, m.id);
      const links = await Promise.all(photos.map(async (d) => ({ id: d.id, url: (await getDocumentUrl(ctx, d.id)).url, name: d.fileName })));
      return { m, links };
    }),
  );

  return (
    <>
      <PageHeader
        eyebrow="Handover"
        title="Move-in"
        subtitle="The recorded condition of your unit at handover. Both you and the other party confirm it — this is the shared record."
      />
      {withPhotos.length === 0 ? (
        <EmptyState message="No move-in record yet." />
      ) : (
        <div className="space-y-6">
          {withPhotos.map(({ m, links }) => {
            const acknowledged = !!m[myAck];
            return (
              <Card key={m.id}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-lg text-navy-900">{propLabel(m.property)}</h2>
                  <Badge value={m.status} />
                </div>
                {m.notes ? <p className="mb-3 text-sm text-navy-700">{m.notes}</p> : null}
                <div className="mb-3 text-xs text-muted">
                  Landlord: {m.landlordAckAt ? `acknowledged ${formatDubaiDate(m.landlordAckAt)}` : "pending"} ·{" "}
                  Tenant: {m.tenantAckAt ? `acknowledged ${formatDubaiDate(m.tenantAckAt)}` : "pending"}
                </div>

                {links.length > 0 && (
                  <ul className="mb-4 grid gap-2 sm:grid-cols-2">
                    {links.map((l) => (
                      <li key={l.id}>
                        <a href={l.url} target="_blank" rel="noreferrer" className="text-sm text-gold-700 hover:underline">{l.name}</a>
                      </li>
                    ))}
                  </ul>
                )}

                {acknowledged ? (
                  <p className="text-sm text-verde-700">You have acknowledged this condition record.</p>
                ) : (
                  <form action={acknowledgeMoveInAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit">Acknowledge condition</Button>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
