#!/usr/bin/env node
// Recurring scope-audit gate (hardening). The F0a/F0b boundary only holds if every
// persona-accessible LIST read goes through a sanctioned scope primitive — a
// hand-rolled `where:{ workspaceId }` fails OPEN for a persona (the listSecureLinks
// bug F0a fixed). This is a thin, mechanical check that flags any `findMany`/`findFirst`
// on a persona-accessible model whose enclosing function shows no scoping gate.
//
// It does NOT prove the scope is *correct* (only that one exists) — but it catches the
// "forgot to scope entirely" class as the surface grows. Escape hatch for legitimately
// ungated reads (system crons, secure-link/public paths): an inline `scope-audit: <why>`
// comment in the function.
//
// Run: node scripts/scope-audit.mjs            (CI gate)
//      node scripts/scope-audit.mjs --selftest (verify the gate itself still works)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/server/services"];
// Files that ARE the scope infrastructure (they resolve scope; nothing to gate them by).
const ALLOW_FILES = new Set([
  "src/server/services/contactScope.ts",
  "src/server/services/clientScope.ts",
]);

// Prisma accessors for models a persona (TENANT/LANDLORD/CLIENT_VIEWER) can reach.
const PERSONA_MODELS = new Set([
  "tenancy", "property", "paymentItem", "deadline", "document", "proofRequest",
  "listing", "offer", "tenantPassport", "moveIn", "contractPack", "enquiry",
  "viewing", "secureLink",
]);

// Tokens whose presence in the enclosing function means "this read is gated".
const SCOPE_TOKENS = [
  "scope(ctx", "contactScopedWhere", "assertReadable", "assertSameWorkspace",
  "clientScope(ctx", "resolveContactScopeIds", "resolveClientScopeIds",
  "scopeMatchClauses", "scopeBelongsTo",
  // by-id getters / loaders that themselves enforce the contact scope:
  "getTenancy(", "getListing(", "getProperty(", "getDocument(", "getProofRequest(",
  "loadMoveIn(", "loadPack(", "getOrCreateMyPassport(", "getPassport(",
  "scope-audit:",
];

const READ_RE = /prisma\.(\w+)\.(findMany|findFirst)\b/;
// Top-level declarations only (column 0) — inner indented arrow consts are NOT
// function boundaries, so a helper-arrow doesn't split a scoped function in two.
const FUNC_START_RE = /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?const\s+\w+\s*=\s*(async\s*)?(\(|function)/;

function enclosingFunction(lines, idx) {
  let start = 0;
  for (let i = idx; i >= 0; i--) {
    if (FUNC_START_RE.test(lines[i])) { start = i; break; }
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (FUNC_START_RE.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

/** Return the ungated persona-model reads in one file's source. */
export function scanSource(file, content) {
  const found = [];
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    const m = READ_RE.exec(line);
    if (!m || !PERSONA_MODELS.has(m[1])) return;
    const body = enclosingFunction(lines, i);
    if (SCOPE_TOKENS.some((t) => body.includes(t))) return;
    found.push({ file, line: i + 1, model: m[1], op: m[2] });
  });
  return found;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function selftest() {
  const bad = `export async function leak(ctx) {\n  return prisma.document.findMany({ where: { workspaceId: ctx.workspaceId } });\n}`;
  const good = `export async function ok(ctx) {\n  return prisma.document.findMany({ where: { ...scope(ctx) } });\n}`;
  const annotated = `export async function cron(workspaceId) {\n  // scope-audit: nightly batch, no persona ctx\n  return prisma.document.findMany({ where: { workspaceId } });\n}`;
  const fails = [];
  if (scanSource("bad.ts", bad).length !== 1) fails.push("expected the ungated read to be flagged");
  if (scanSource("good.ts", good).length !== 0) fails.push("a scope(ctx) read must pass");
  if (scanSource("annotated.ts", annotated).length !== 0) fails.push("a scope-audit-annotated read must pass");
  if (fails.length) {
    console.error("✗ scope-audit selftest FAILED — the gate is not working:");
    for (const f of fails) console.error("  " + f);
    process.exit(1);
  }
  console.log("✓ scope-audit selftest passed (flags ungated, passes scoped + annotated).");
}

function run() {
  const findings = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (ALLOW_FILES.has(file)) continue;
      findings.push(...scanSource(file, readFileSync(file, "utf8")));
    }
  }
  if (findings.length > 0) {
    console.error("✗ scope-audit: ungated persona-model reads found.\n");
    console.error("Each list read of a persona-accessible model must route through a scope");
    console.error("primitive (scope/contactScopedWhere/assertReadable/...) or, if intentionally");
    console.error("ungated (system cron, secure-link/public path), carry an inline");
    console.error("`scope-audit: <reason>` comment in the function.\n");
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  prisma.${f.model}.${f.op} — no scope gate in the enclosing function`);
    }
    process.exit(1);
  }
  console.log("✓ scope-audit: every persona-model list read is gated.");
}

if (process.argv.includes("--selftest")) selftest();
else run();
