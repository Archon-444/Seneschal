import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_, scope } from "../authz";
import { allScopeIds, resolveClientScopeIds } from "./clientScope";
import { recordEvidence } from "../evidence";
import { formatDubaiDate, todayInDubai } from "../calculators/dates";

// Monthly client report (T10.1): properties, tenancies, upcoming deadlines,
// cheque statuses, open proof requests, risk flags, missing documents.
// Rendered as printable HTML (browser print → PDF); CSV export per D14.

export interface ClientReportData {
  client: { id: string; displayName: string };
  generatedAt: string;
  properties: Awaited<ReturnType<typeof collectProperties>>;
  deadlines: { kind: string; dueAt: Date; property: string }[];
  payments: { property: string; seq: number; dueDate: Date; amount: string; status: string; chequeNo: string | null }[];
  proofRequests: { title: string; status: string; dueAt: Date | null }[];
  riskFlags: { code: string; severity: string; raisedAt: Date }[];
  missingDocuments: string[];
}

async function collectProperties(workspaceId: string, clientPrincipalId: string) {
  // scope-audit: client-scoped report helper (filtered by clientPrincipalId); the
  // caller buildClientReport gates on reports.generate + the viewer's own client.
  return prisma.property.findMany({
    where: { workspaceId, clientPrincipalId, archivedAt: null },
    include: {
      tenancies: {
        where: { archivedAt: null },
        include: { paymentItems: { orderBy: { seq: "asc" } } },
      },
    },
  });
}

export async function buildClientReport(
  ctx: AuthzContext,
  clientPrincipalId: string,
): Promise<ClientReportData> {
  require_(ctx, "reports.generate");
  if (ctx.clientPrincipalId && ctx.clientPrincipalId !== clientPrincipalId) {
    throw new AuthzError("Not found", 404);
  }
  const client = await prisma.clientPrincipal.findFirst({
    where: { id: clientPrincipalId, workspaceId: ctx.workspaceId },
  });
  if (!client) throw new AuthzError("Not found", 404);

  const properties = await collectProperties(ctx.workspaceId, clientPrincipalId);
  const tenancyIds = properties.flatMap((p) => p.tenancies.map((t) => t.id));
  const propertyName = (id: string) => {
    const p = properties.find((x) => x.id === id);
    return p ? `${p.community}${p.building ? ` · ${p.building}` : ""}${p.unitNo ? ` · ${p.unitNo}` : ""}` : id;
  };

  const deadlines = await prisma.deadline.findMany({
    where: { tenancyId: { in: tenancyIds }, status: "OPEN" },
    orderBy: { dueAt: "asc" },
    include: { tenancy: true },
  });

  const payments = properties.flatMap((p) =>
    p.tenancies.flatMap((t) =>
      t.paymentItems.map((i) => ({
        property: propertyName(p.id),
        seq: i.seq,
        dueDate: i.dueDate,
        amount: String(i.amount),
        status: i.status,
        chequeNo: i.chequeNo,
      })),
    ),
  );

  // The report is per-client: proof requests and risk flags are scope-polymorphic,
  // so constrain both to scopes resolving to this client (T1.4 class of leak).
  const clientIds = await resolveClientScopeIds(ctx.workspaceId, clientPrincipalId);
  const proofRequests = await prisma.proofRequest.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      id: { in: clientIds.proofRequestIds },
      status: { notIn: ["APPROVED", "CLOSED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const riskFlags = await prisma.riskFlag.findMany({
    where: { workspaceId: ctx.workspaceId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });
  const clientFlagScopes = new Set(allScopeIds(clientIds));

  const missingDocuments: string[] = [];
  for (const p of properties) {
    for (const t of p.tenancies) {
      if (!t.contractDocId) missingDocuments.push(`Tenancy contract — ${propertyName(p.id)}`);
      if (!t.ejariNo) missingDocuments.push(`Ejari certificate — ${propertyName(p.id)}`);
    }
  }

  return {
    client: { id: client.id, displayName: client.displayName },
    generatedAt: formatDubaiDate(todayInDubai()),
    properties,
    deadlines: deadlines.map((d) => ({
      kind: d.kind,
      dueAt: d.dueAt,
      property: d.tenancy ? propertyName(d.tenancy.propertyId) : "",
    })),
    payments,
    proofRequests: proofRequests.map((r) => ({ title: r.title, status: r.status, dueAt: r.dueAt })),
    riskFlags: riskFlags
      .filter((f) => clientFlagScopes.has(f.scopeId))
      .map((f) => ({ code: f.code, severity: f.severity, raisedAt: f.raisedAt })),
    missingDocuments,
  };
}

export async function generateClientReport(ctx: AuthzContext, clientPrincipalId: string) {
  const data = await buildClientReport(ctx, clientPrincipalId);
  const report = await prisma.report.create({
    data: {
      workspaceId: ctx.workspaceId,
      kind: "client_monthly",
      clientPrincipalId,
      params: { generatedAt: data.generatedAt },
      generatedById: ctx.userId,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "REPORT_GENERATED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "REPORT",
    scopeId: report.id,
    payload: { kind: "client_monthly", clientPrincipalId },
  });
  return { report, data };
}

/** CSV export of underlying tables (D14). Writes REPORT_EXPORTED evidence. */
export async function exportClientCsv(ctx: AuthzContext, clientPrincipalId: string) {
  const data = await buildClientReport(ctx, clientPrincipalId);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push("section,property,detail,date,amount,status");
  for (const d of data.deadlines) {
    lines.push(["deadline", d.property, d.kind, d.dueAt.toISOString().slice(0, 10), "", ""].map(esc).join(","));
  }
  for (const p of data.payments) {
    lines.push(["payment", p.property, `cheque ${p.chequeNo ?? p.seq}`, p.dueDate.toISOString().slice(0, 10), p.amount, p.status].map(esc).join(","));
  }
  for (const r of data.proofRequests) {
    lines.push(["proof_request", "", r.title, r.dueAt?.toISOString().slice(0, 10) ?? "", "", r.status].map(esc).join(","));
  }
  for (const f of data.riskFlags) {
    lines.push(["risk_flag", "", f.code, f.raisedAt.toISOString().slice(0, 10), "", f.severity].map(esc).join(","));
  }
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "REPORT_EXPORTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "CLIENT",
    scopeId: clientPrincipalId,
    payload: { format: "csv" },
  });
  return lines.join("\n");
}

export async function listReports(ctx: AuthzContext) {
  require_(ctx, "reports.read");
  return prisma.report.findMany({
    where: {
      ...scope(ctx),
      ...(ctx.clientPrincipalId ? { clientPrincipalId: ctx.clientPrincipalId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}
