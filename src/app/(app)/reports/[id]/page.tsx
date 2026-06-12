import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { buildClientReport, listReports } from "@/server/services/reports";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, LinkButton, Money, Table, Td } from "@/components/ui";

// Screen 16 — printable monthly client report (T10.1). Print → PDF.

export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const reports = await listReports(ctx);
  const report = reports.find((r) => r.id === id);
  if (!report || !report.clientPrincipalId) notFound();

  const data = await buildClientReport(ctx, report.clientPrincipalId);

  return (
    <div className="mx-auto max-w-4xl bg-white p-10 print:p-0">
      <div className="mb-8 flex items-start justify-between border-b-2 border-navy-900 pb-6">
        <div>
          <div className="font-display text-3xl text-navy-900">Seneschal</div>
          <div className="mt-1 text-sm text-navy-500">Monthly portfolio report</div>
        </div>
        <div className="text-right">
          <div className="font-display text-xl text-navy-900">{data.client.displayName}</div>
          <div className="figure text-sm text-navy-500">Generated {data.generatedAt}</div>
        </div>
      </div>
      <div className="mb-6 flex gap-2 print:hidden">
        <LinkButton href={`/api/v1/clients/${data.client.id}/export.csv`}>Download CSV</LinkButton>
        <span className="self-center text-xs text-navy-300">Use your browser&apos;s print dialog for PDF.</span>
      </div>

      <Section title="Properties & tenancies">
        <Table headers={["Property", "Tenancy", "Rent", "Ejari"]}>
          {data.properties.map((p) => {
            const t = p.tenancies[0];
            return (
              <tr key={p.id}>
                <Td>{p.community}{p.building ? ` · ${p.building}` : ""}{p.unitNo ? ` · ${p.unitNo}` : ""}</Td>
                <Td className="figure text-xs">
                  {t ? `${formatDubaiDate(t.startDate)} → ${formatDubaiDate(t.endDate)}` : "vacant"}
                </Td>
                <Td>{t ? <Money amount={String(t.annualRent)} /> : "—"}</Td>
                <Td className="figure text-xs">{t?.ejariNo ?? <span className="text-claret-500">missing</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title="Upcoming deadlines">
        <Table headers={["Due", "Kind", "Property"]}>
          {data.deadlines.map((d, i) => (
            <tr key={i}>
              <Td className="figure">{formatDubaiDate(d.dueAt)}</Td>
              <Td><Badge value={d.kind} /></Td>
              <Td>{d.property}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Cheque register">
        <Table headers={["Due", "Property", "#", "Amount", "Status"]}>
          {data.payments.map((p, i) => (
            <tr key={i}>
              <Td className="figure">{formatDubaiDate(p.dueDate)}</Td>
              <Td>{p.property}</Td>
              <Td className="figure">{p.chequeNo ?? p.seq}</Td>
              <Td><Money amount={p.amount} /></Td>
              <Td><Badge value={p.status} /></Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Open proof requests">
        <Table headers={["Title", "Due", "Status"]}>
          {data.proofRequests.map((r, i) => (
            <tr key={i}>
              <Td>{r.title}</Td>
              <Td className="figure">{r.dueAt ? formatDubaiDate(r.dueAt) : "—"}</Td>
              <Td><Badge value={r.status} /></Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Risk flags">
        <Table headers={["Raised", "Code", "Severity"]}>
          {data.riskFlags.map((f, i) => (
            <tr key={i}>
              <Td className="figure">{formatDubaiDate(f.raisedAt)}</Td>
              <Td><Badge value={f.code} /></Td>
              <Td><Badge value={f.severity} /></Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Missing documents">
        {data.missingDocuments.length === 0 ? (
          <p className="text-sm text-verde-700">Nothing missing.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm text-navy-700">
            {data.missingDocuments.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </Section>

      <p className="mt-10 border-t border-ivory-300 pt-4 text-xs text-navy-300">
        Record-keeping report based on supplied data. Rule-based calculations — review before action.
        Seneschal holds no funds and provides no legal advice.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-display mb-3 text-xl text-navy-900">{title}</h2>
      {children}
    </section>
  );
}
