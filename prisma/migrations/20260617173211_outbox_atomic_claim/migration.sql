-- H1: atomic outbox claim via SELECT … FOR UPDATE SKIP LOCKED.
-- Adds the lease window column and the provider-level idempotency key.
ALTER TABLE "Outbox"
  ADD COLUMN "lockedUntil"    TIMESTAMP(3),
  ADD COLUMN "idempotencyKey" TEXT;

-- Postgres treats NULL idempotency keys as distinct, so the constraint only
-- catches duplicate enqueues for topics that actually opted into idempotency
-- (notification.send, whatsapp.status, …).
CREATE UNIQUE INDEX "Outbox_topic_idempotencyKey_key"
  ON "Outbox"("topic", "idempotencyKey");
