import { prisma } from "../db";
import { validateLinkToken, consumeLinkUse } from "./secureLinks";
import { submitProofViaLink } from "./proofs";

// Proof submission via email (T7.4). The tokenized address proof+<token>@…
// routes the attachment through the same pipeline as the link upload page.

const TOKEN_ADDRESS = /(?:^|<)proof\+([A-Za-z0-9_-]+)@/;

export async function processInboundProofEmail(message: {
  to: string;
  from: string;
  subject?: string;
  text?: string;
  attachments: { fileName: string; mime: string; data: Buffer }[];
}): Promise<{ accepted: boolean; reason?: string }> {
  const match = TOKEN_ADDRESS.exec(message.to);
  if (!match) return { accepted: false, reason: "no_token" };

  const validation = await validateLinkToken(match[1]);
  if (!validation.ok) return { accepted: false, reason: validation.reason };
  if (message.attachments.length === 0) return { accepted: false, reason: "no_attachments" };

  // H4: consume-first; a lost race (e.g. duplicate inbound delivery of the same
  // mail) short-circuits before re-ingesting the attachments.
  const { consumed } = await consumeLinkUse(validation.link.id);
  if (!consumed) return { accepted: false, reason: "exhausted" };

  await submitProofViaLink(
    validation.link,
    message.attachments,
    message.text?.slice(0, 2000) || message.subject,
  );

  // inbound message recorded for the notification log
  await prisma.notificationMessage.create({
    data: {
      workspaceId: validation.link.workspaceId,
      channel: "EMAIL",
      direction: "INBOUND",
      toContactId: validation.link.contactId,
      templateCode: "proof_email_intake_v1",
      subject: message.subject ?? null,
      status: "RECEIVED",
      relatedType: "PROOF_REQUEST",
      relatedId: validation.link.scopeId,
    },
  });
  return { accepted: true };
}

/** Tokenized intake address for a secure link token (shown in outbound mail). */
export function intakeAddress(token: string): string {
  const domain = process.env.EMAIL_INTAKE_DOMAIN ?? "intake.seneschal.example";
  return `proof+${token}@${domain}`;
}
