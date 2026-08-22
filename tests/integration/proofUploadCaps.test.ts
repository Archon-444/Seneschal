import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as proofs from "@/server/services/proofs";
import * as contacts from "@/server/services/contacts";
import {
  MAX_FILES_PER_REQUEST,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
} from "@/lib/uploadLimits";

// Issue #53 — the public proof-upload endpoint is unauthenticated, so every cap
// has to hold against a direct POST, not just against the browser form. These
// drive submitProofAction itself rather than submitProofViaLink, because the
// caps live in the action and the form's client-side sum is only a courtesy.
//
// The load-bearing assertion in each rejection case is the negative one: a
// rejected upload must leave NO document, NO PROOF_UPLOADED evidence event, and
// an unconsumed link. Rejecting with a friendly message but still burning the
// tenant's one-use link, or half-writing evidence, would be its own bug.

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.7"], ["user-agent", "vitest"]]),
  cookies: async () => ({ get: () => undefined }),
}));

const { submitProofAction } = await import("@/app/link/[token]/actions");

let W: TestActor;
let contactId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Fiduciary");
  const c = await contacts.createContact(W.ctx, {
    kind: "AGENT",
    name: "Samir Khan",
    email: "samir@test.example",
  });
  contactId = c.id;
});

async function makeRequestWithLink() {
  const request = await proofs.createProofRequest(W.ctx, {
    scopeType: "WORKSPACE",
    title: "Upload cheque proof",
    requiredEvidence: "Deposit slip photo",
    assignedContactId: contactId,
  });
  const { url } = await proofs.sendProofRequest(W.ctx, request.id);
  return { request, token: url.split("/link/")[1] };
}

function file(name: string, bytes: number, mime = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], name, { type: mime });
}

function submit(token: string, files: File[], note?: string): Promise<{ status: string; message?: string }> {
  const fd = new FormData();
  fd.set("token", token);
  for (const f of files) fd.append("files", f);
  if (note) fd.set("note", note);
  return submitProofAction({ status: "idle" }, fd) as Promise<{ status: string; message?: string }>;
}

/** Nothing trusted was written and the link still has its use. */
async function expectNothingRecorded(requestId: string) {
  expect(await prisma.document.count({ where: { workspaceId: W.workspaceId } })).toBe(0);
  expect(
    await prisma.evidenceEvent.count({ where: { type: "PROOF_UPLOADED", scopeId: requestId } }),
  ).toBe(0);
  const link = await prisma.secureLink.findFirst({ where: { scopeId: requestId } });
  expect(link!.useCount).toBe(0);
}

describe("public proof upload caps (#53)", () => {
  it("rejects a single file over the per-file cap", async () => {
    const { request, token } = await makeRequestWithLink();
    const res = await submit(token, [file("huge.jpg", MAX_UPLOAD_BYTES + 1)]);

    expect(res.status).toBe("error");
    expect(res.message).toMatch(/huge\.jpg is larger than/);
    await expectNothingRecorded(request.id);
  });

  it("rejects more files than the per-request count cap", async () => {
    const { request, token } = await makeRequestWithLink();
    const files = Array.from({ length: MAX_FILES_PER_REQUEST + 1 }, (_, i) =>
      file(`page-${i}.jpg`, 64),
    );
    const res = await submit(token, files);

    expect(res.status).toBe("error");
    expect(res.message).toMatch(new RegExp(`at most ${MAX_FILES_PER_REQUEST} files`));
    await expectNothingRecorded(request.id);
  });

  it("rejects an aggregate over the total cap even when every file is individually legal", async () => {
    const { request, token } = await makeRequestWithLink();
    // Each half is comfortably under MAX_UPLOAD_BYTES, so only the aggregate
    // check can catch this. This is the case that used to reach the server with
    // nothing to stop it: the total sits below serverActions.bodySizeLimit.
    const half = Math.ceil(MAX_UPLOAD_TOTAL_BYTES / 2) + 1024;
    expect(half).toBeLessThan(MAX_UPLOAD_BYTES);
    const res = await submit(token, [file("front.jpg", half), file("back.jpg", half)]);

    expect(res.status).toBe("error");
    expect(res.message).toMatch(/total more than/);
    await expectNothingRecorded(request.id);
  });

  it("accepts a legal multi-file submission and records each one", async () => {
    const { request, token } = await makeRequestWithLink();
    const res = await submit(
      token,
      [file("slip-1.jpg", 2048), file("slip-2.jpg", 2048), file("deed.pdf", 4096, "application/pdf")],
      "Three pages",
    );

    expect(res.status).toBe("done");
    const docs = await prisma.document.findMany({ where: { workspaceId: W.workspaceId } });
    expect(docs.map((d) => d.fileName).sort()).toEqual(["deed.pdf", "slip-1.jpg", "slip-2.jpg"]);
    expect(
      await prisma.evidenceEvent.count({ where: { type: "PROOF_UPLOADED", scopeId: request.id } }),
    ).toBeGreaterThan(0);
    const link = await prisma.secureLink.findFirst({ where: { scopeId: request.id } });
    expect(link!.useCount).toBe(1);
  });

  it("rejects an empty submission without consuming the link", async () => {
    const { request, token } = await makeRequestWithLink();
    const res = await submit(token, []);

    expect(res.status).toBe("error");
    expect(res.message).toMatch(/at least one file/);
    await expectNothingRecorded(request.id);
  });
});
