import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as clients from "@/server/services/clients";
import * as properties from "@/server/services/properties";
import { onboardTenancy } from "@/server/services/onboarding";

// Search across the list pages + contact detail (party → contracts).

let W: TestActor;
let clientId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Search WS");
  clientId = (await clients.createClient(W.ctx, { displayName: "Al Noor Family Office" })).id;
});

describe("contact search", () => {
  it("matches on name, email, phone and Emirates ID, case-insensitively", async () => {
    await contacts.createContact(W.ctx, {
      kind: "TENANT",
      name: "Raymond Schmitt",
      email: "ray@example.com",
      phone: "0556127350",
      emiratesId: "784-1982-2983642-8",
    });
    await contacts.createContact(W.ctx, { kind: "OWNER", name: "Bassam Rizk" });

    expect((await contacts.listContacts(W.ctx, { q: "raymond" })).map((c) => c.name)).toEqual(["Raymond Schmitt"]);
    expect((await contacts.listContacts(W.ctx, { q: "RAY@" }))).toHaveLength(1);
    expect((await contacts.listContacts(W.ctx, { q: "2983642" }))).toHaveLength(1);
    expect((await contacts.listContacts(W.ctx, { q: "0556" }))).toHaveLength(1);
    expect((await contacts.listContacts(W.ctx, { q: "rizk" })).map((c) => c.name)).toEqual(["Bassam Rizk"]);
    expect((await contacts.listContacts(W.ctx, { q: "nomatch" }))).toHaveLength(0);
    expect((await contacts.listContacts(W.ctx))).toHaveLength(2); // no q → all
  });
});

describe("property search", () => {
  it("matches on community/unit and on the tenancy Ejari number", async () => {
    await onboardTenancy(W.ctx, {
      newProperty: { clientPrincipalId: clientId, community: "Al Barsha South Fifth", unitNo: "8K14" },
      ejariNo: "2025/JVT-8K14",
      startDate: new Date("2025-04-20"),
      endDate: new Date("2026-04-19"),
      annualRent: 200000,
    });
    await properties.createProperty(W.ctx, { clientPrincipalId: clientId, community: "Dubai Marina", unitNo: "1204" });

    expect((await properties.listProperties(W.ctx, { q: "barsha" }))).toHaveLength(1);
    expect((await properties.listProperties(W.ctx, { q: "8K14" }))).toHaveLength(1);
    expect((await properties.listProperties(W.ctx, { q: "JVT-8K14" }))).toHaveLength(1); // via Ejari
    expect((await properties.listProperties(W.ctx, { q: "marina" }))).toHaveLength(1);
    expect((await properties.listProperties(W.ctx))).toHaveLength(2);
  });
});

describe("client search", () => {
  it("filters by display name", async () => {
    await clients.createClient(W.ctx, { displayName: "Private Client A" });
    expect((await clients.listClients(W.ctx, { q: "noor" })).map((c) => c.displayName)).toEqual(["Al Noor Family Office"]);
    expect((await clients.listClients(W.ctx))).toHaveLength(2);
  });
});

describe("contact detail", () => {
  it("returns the contracts a party is on, with role resolvable, and assigned proofs", async () => {
    const result = await onboardTenancy(W.ctx, {
      newLandlord: { name: "Bassam Rizk", emiratesId: "784-1985-7053614-8" },
      newTenant: { name: "Raymond Schmitt" },
      newProperty: { clientPrincipalId: clientId, community: "Al Barsha", unitNo: "8K14" },
      ejariNo: "E-1",
      startDate: new Date("2025-04-20"),
      endDate: new Date("2026-04-19"),
      annualRent: 200000,
    });

    const landlordDetail = await contacts.getContactDetail(W.ctx, result.landlordContactId!);
    expect(landlordDetail.contact.emiratesId).toBe("784-1985-7053614-8");
    expect(landlordDetail.tenancies.map((t) => t.id)).toContain(result.tenancyId);
    expect(landlordDetail.tenancies[0].landlordContactId).toBe(result.landlordContactId);

    const tenantDetail = await contacts.getContactDetail(W.ctx, result.tenantContactId!);
    expect(tenantDetail.tenancies.map((t) => t.id)).toContain(result.tenancyId);
  });

  it("refuses a contact from another workspace", async () => {
    const other = await makeWorkspace("Other WS");
    const c = await contacts.createContact(other.ctx, { kind: "TENANT", name: "Theirs" });
    await expect(contacts.getContactDetail(W.ctx, c.id)).rejects.toThrow();
  });
});
