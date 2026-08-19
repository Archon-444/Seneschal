import { Prisma } from "@prisma/client";
import { prisma } from "../db";

// A Contact is shared: the same person is a tenancy party on one record, a
// proof assignee on another, and a membership subject on a third. Import
// rollback archives the contacts a batch created, and that is only safe when
// nothing outside the batch still points at them (review finding MEDIUM-7).
//
// The referrer set is derived from the Prisma schema rather than hand-listed,
// so a future `Foo.witnessContactId` is covered the day it is added instead of
// silently slipping past this guard. `contactReferrers` is asserted against the
// schema in tests/unit/contactReferences.test.ts.

type Db = Prisma.TransactionClient;

export interface ContactReferrer {
  /** Model name as written in schema.prisma, used in the human-readable reason. */
  model: string;
  /** Prisma client delegate for that model. */
  delegate: string;
  /** Scalar fields on the model that hold a Contact id. */
  fields: string[];
  /** Archived rows are not live references, so models carrying archivedAt filter on it. */
  hasArchivedAt: boolean;
}

let cached: ContactReferrer[] | null = null;

/** Every model/field pair in the schema that stores a Contact id. */
export function contactReferrers(): ContactReferrer[] {
  if (cached) return cached;
  const out: ContactReferrer[] = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = model.fields
      .filter((f) => f.kind === "scalar" && /ContactId$/.test(f.name))
      .map((f) => f.name);
    if (!fields.length) continue;
    out.push({
      model: model.name,
      delegate: model.name.charAt(0).toLowerCase() + model.name.slice(1),
      fields,
      hasArchivedAt: model.fields.some((f) => f.name === "archivedAt"),
    });
  }
  cached = out;
  return out;
}

type CountDelegate = { count(args: { where: Record<string, unknown> }): Promise<number> };

/**
 * The models that still hold a live reference to this contact, as schema model
 * names. Empty means the contact is unreferenced and may be archived.
 *
 * scope-audit: every query is workspace-filtered on the caller's workspaceId;
 * the delegate is resolved by name off the same client the caller passes in.
 */
export async function findContactReferences(
  workspaceId: string,
  contactId: string,
  db: Db = prisma,
): Promise<string[]> {
  const found: string[] = [];
  for (const ref of contactReferrers()) {
    const delegate = (db as unknown as Record<string, CountDelegate | undefined>)[ref.delegate];
    // A schema rename must fail loudly: silently skipping a referrer would let
    // rollback archive a contact something still points at.
    if (!delegate?.count) {
      throw new Error(`No Prisma delegate "${ref.delegate}" for contact reference check`);
    }
    const where: Record<string, unknown> = {
      workspaceId,
      OR: ref.fields.map((f) => ({ [f]: contactId })),
    };
    if (ref.hasArchivedAt) where.archivedAt = null;
    if (await delegate.count({ where })) found.push(ref.model);
  }
  return found;
}
