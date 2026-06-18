import { type NoticeKind, type ServiceMethod } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_ } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { getTenancy } from "./tenancies";

// Notice service (PR6 Stage-2). The landlord's change/renewal notice was
// previously implicit on RenewalCase.noticeServedAt/noticeDocId; this surface
// promotes it to a state machine — GENERATED → APPROVED → SERVED — and emits
// one evidence row at each transition, at the transition's real moment. Batch-
// emitting at mint time would stamp every row with the mint timestamp and make
// the timeline lie; on an append-only platform the timeline's truthfulness IS
// the product.
//
// The two paths can coexist with the legacy renewals.serveNotice (which just
// stamps the case): operators using the formal flow get the three rows in order;
// operators using the quick path keep their single row.

export interface PrepareNoticeInput {
  renewalCaseId: string;
  kind: NoticeKind;
  templateCode?: string;
  templateVersion?: string;
  docId?: string;
}

/** Generate a notice draft. Emits NOTICE_GENERATED at this transition's moment. */
export async function prepareNotice(ctx: AuthzContext, input: PrepareNoticeInput) {
  require_(ctx, "renewals.decide");
  const rc = await prisma.renewalCase.findUnique({ where: { id: input.renewalCaseId } });
  assertSameWorkspace(ctx, rc);
  await getTenancy(ctx, rc!.tenancyId); // client-scope gate

  const notice = await prisma.notice.create({
    data: {
      workspaceId: ctx.workspaceId,
      renewalCaseId: input.renewalCaseId,
      kind: input.kind,
      status: "GENERATED",
      docId: input.docId ?? null,
      templateCode: input.templateCode ?? null,
      templateVersion: input.templateVersion ?? null,
    },
  });
  await prisma.renewalCase.update({
    where: { id: input.renewalCaseId },
    data: { currentNoticeId: notice.id },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "NOTICE_GENERATED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "RENEWAL_CASE",
    scopeId: input.renewalCaseId,
    tenancyId: rc!.tenancyId,
    propertyId: rc!.propertyId,
    payload: { noticeId: notice.id, kind: input.kind, templateCode: input.templateCode },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "notice.prepare",
    objectType: "Notice",
    objectId: notice.id,
  });
  return notice;
}

/** Approve a generated notice. Emits NOTICE_APPROVED at this transition's moment. */
export async function approveNotice(ctx: AuthzContext, noticeId: string) {
  require_(ctx, "renewals.decide");
  const notice = await prisma.notice.findUnique({ where: { id: noticeId } });
  assertSameWorkspace(ctx, notice);
  if (notice!.status !== "GENERATED") {
    throw new AuthzError(`Notice cannot be approved from ${notice!.status}`, 422);
  }
  const rc = await prisma.renewalCase.findUnique({ where: { id: notice!.renewalCaseId } });
  await getTenancy(ctx, rc!.tenancyId);

  const updated = await prisma.notice.update({
    where: { id: noticeId },
    data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.userId },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "NOTICE_APPROVED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "RENEWAL_CASE",
    scopeId: notice!.renewalCaseId,
    tenancyId: rc!.tenancyId,
    propertyId: rc!.propertyId,
    payload: { noticeId },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "notice.approve",
    objectType: "Notice",
    objectId: noticeId,
  });
  return updated;
}

export interface ServeNoticeInput {
  noticeId: string;
  serviceMethod: ServiceMethod;
  serviceRef?: string;
  servedAt?: Date;
  docId?: string;
}

/** Record service of an approved notice. Emits NOTICE_SERVED at this moment.
 *  Also stamps the case's noticeServedAt/noticeDocId so the legacy renewal
 *  pipeline reads stay consistent. */
export async function serveNoticeFormal(ctx: AuthzContext, input: ServeNoticeInput) {
  require_(ctx, "renewals.decide");
  const notice = await prisma.notice.findUnique({ where: { id: input.noticeId } });
  assertSameWorkspace(ctx, notice);
  if (notice!.status !== "APPROVED") {
    throw new AuthzError(`Notice must be APPROVED before service (current: ${notice!.status})`, 422);
  }
  const rc = await prisma.renewalCase.findUnique({ where: { id: notice!.renewalCaseId } });
  await getTenancy(ctx, rc!.tenancyId);

  const servedAt = input.servedAt ?? new Date();
  await prisma.$transaction([
    prisma.notice.update({
      where: { id: input.noticeId },
      data: {
        status: "SERVED",
        servedAt,
        servedById: ctx.userId,
        serviceMethod: input.serviceMethod,
        serviceRef: input.serviceRef ?? null,
        docId: input.docId ?? notice!.docId,
      },
    }),
    prisma.renewalCase.update({
      where: { id: rc!.id },
      data: {
        status: "NOTICE_SERVED",
        noticeServedAt: servedAt,
        noticeDocId: input.docId ?? notice!.docId,
      },
    }),
  ]);
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "NOTICE_SERVED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "RENEWAL_CASE",
    scopeId: rc!.id,
    tenancyId: rc!.tenancyId,
    propertyId: rc!.propertyId,
    payload: { noticeId: input.noticeId, serviceMethod: input.serviceMethod, serviceRef: input.serviceRef ?? null },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "notice.serve",
    objectType: "Notice",
    objectId: input.noticeId,
  });
  return prisma.notice.findUnique({ where: { id: input.noticeId } });
}
