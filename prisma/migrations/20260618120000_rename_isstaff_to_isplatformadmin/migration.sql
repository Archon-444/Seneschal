-- F-Admin §3 / D2: the platform identity is renamed isStaff → isPlatformAdmin to mean
-- exactly "Seneschal operator plane" (lifecycle/billing/aggregate stats, never customer data).
-- RENAME (not drop+add) so the seeded operator account and any existing flag survive the deploy.
ALTER TABLE "User" RENAME COLUMN "isStaff" TO "isPlatformAdmin";
