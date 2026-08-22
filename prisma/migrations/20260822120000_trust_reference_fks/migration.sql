-- #58: foreign keys for non-polymorphic trust references.
--
-- These columns have always stored a single target table's id (Contact or
-- ClientPrincipal). They were left as bare strings so early imports could land
-- before the referenced row existed; that loophole is closed. Intentionally
-- polymorphic ids (EvidenceEvent.scopeId, Document.scopeId, AuditEvent.objectId,
-- SecureLink.scopeId, NotificationMessage.scopeId, RiskFlag.scopeId) stay
-- strings — see docs/trust-references.md.
--
-- PRE-FLIGHT: each ADD CONSTRAINT fails if an orphan already exists. The
-- DO-block below names the offending ids so a deploy log is actionable.
-- Contacts and clients are archived, never hard-deleted; ON DELETE RESTRICT
-- matches that (a still-referenced party cannot be removed).

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM "Tenancy" t
    LEFT JOIN "Contact" c ON c."id" = t."landlordContactId"
   WHERE t."landlordContactId" IS NOT NULL AND c."id" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% Tenancy row(s) have landlordContactId with no Contact', n;
  END IF;

  SELECT count(*) INTO n FROM "Tenancy" t
    LEFT JOIN "Contact" c ON c."id" = t."tenantContactId"
   WHERE t."tenantContactId" IS NOT NULL AND c."id" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% Tenancy row(s) have tenantContactId with no Contact', n;
  END IF;

  SELECT count(*) INTO n FROM "Property" p
    LEFT JOIN "ClientPrincipal" c ON c."id" = p."clientPrincipalId"
   WHERE p."clientPrincipalId" IS NOT NULL AND c."id" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% Property row(s) have clientPrincipalId with no ClientPrincipal', n;
  END IF;

  SELECT count(*) INTO n FROM "Property" p
    LEFT JOIN "Contact" c ON c."id" = p."ownerContactId"
   WHERE p."ownerContactId" IS NOT NULL AND c."id" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% Property row(s) have ownerContactId with no Contact', n;
  END IF;

  SELECT count(*) INTO n FROM "Property" p
    LEFT JOIN "Contact" c ON c."id" = p."assignedAgentId"
   WHERE p."assignedAgentId" IS NOT NULL AND c."id" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% Property row(s) have assignedAgentId with no Contact', n;
  END IF;
END $$;

ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_landlordContactId_fkey"
  FOREIGN KEY ("landlordContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_tenantContactId_fkey"
  FOREIGN KEY ("tenantContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Property" ADD CONSTRAINT "Property_clientPrincipalId_fkey"
  FOREIGN KEY ("clientPrincipalId") REFERENCES "ClientPrincipal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerContactId_fkey"
  FOREIGN KEY ("ownerContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Property" ADD CONSTRAINT "Property_assignedAgentId_fkey"
  FOREIGN KEY ("assignedAgentId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
