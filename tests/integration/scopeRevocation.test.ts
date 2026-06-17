import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as documents from "@/server/services/documents";
import { resolveContactScopeIds } from "@/server/services/contactScope";

// Security regression (Vuln 1): a TENANT's contact scope is time-bounded to ACTIVE
// tenancies. Once a tenancy is archived, the former tenant must lose all scope over
// that unit — otherwise they could read a later tenant's PROPERTY/TENANCY-scoped
// documents (move-in photos, contract terms) via the generic document surface.

let W: TestActor;
let propertyId: string;
let formerTenancyId: string;
let formerContactId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Scope revocation WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const former = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Former Tenant" });
  formerContactId = former.id;
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id, ownerContactId: owner.id, community: "Marina", unitNo: "1",
  });
  propertyId = property.id;
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: property.id, tenantContactId: former.id, landlordContactId: owner.id,
    startDate: new Date("2025-01-01"), endDate: new Date("2025-12-31"), annualRent: 80000, ejariNo: "OLD-1",
  });
  formerTenancyId = tenancy.id;
});

describe("active-tenancy scope bounding", () => {
  it("drops a unit from a tenant's scope once their tenancy is archived", async () => {
    const before = await resolveContactScopeIds(W.workspaceId, formerContactId, "TENANT");
    expect(before.propertyIds).toContain(propertyId);
    expect(before.tenancyIds).toContain(formerTenancyId);

    await tenancies.archiveTenancy(W.ctx, formerTenancyId);

    const after = await resolveContactScopeIds(W.workspaceId, formerContactId, "TENANT");
    expect(after.propertyIds).not.toContain(propertyId);
    expect(after.tenancyIds).not.toContain(formerTenancyId);
  });

  it("a former tenant can no longer read documents on the unit they left", async () => {
    // Operator uploads property- and tenancy-scoped docs (as a later tenant's would be).
    const propDoc = await documents.uploadDocument(W.ctx, {
      scopeType: "PROPERTY", scopeId: propertyId, kind: "OTHER",
      fileName: "p.txt", mime: "text/plain", data: Buffer.from("p"),
    });
    const tenDoc = await documents.uploadDocument(W.ctx, {
      scopeType: "TENANCY", scopeId: formerTenancyId, kind: "OTHER",
      fileName: "t.txt", mime: "text/plain", data: Buffer.from("t"),
    });

    await tenancies.archiveTenancy(W.ctx, formerTenancyId);
    const former = await addMember(W.workspaceId, "TENANT", undefined, formerContactId);

    expect(await documents.listDocuments(former.ctx)).toHaveLength(0);
    await expect(documents.getDocument(former.ctx, propDoc.id)).rejects.toThrow();
    await expect(documents.getDocument(former.ctx, tenDoc.id)).rejects.toThrow();
    await expect(documents.getDocumentUrl(former.ctx, propDoc.id)).rejects.toThrow();
  });
});
