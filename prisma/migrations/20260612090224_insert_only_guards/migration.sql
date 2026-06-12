-- Insert-only enforcement for evidence ledgers (schema convention + T5.2/T8.1).
-- App layer is primary enforcement; these triggers are the DB backstop.
CREATE OR REPLACE FUNCTION seneschal_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is insert-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_event_insert_only
  BEFORE UPDATE OR DELETE ON "EvidenceEvent"
  FOR EACH ROW EXECUTE FUNCTION seneschal_block_mutation();

CREATE TRIGGER audit_event_insert_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION seneschal_block_mutation();

CREATE TRIGGER document_access_log_insert_only
  BEFORE UPDATE OR DELETE ON "DocumentAccessLog"
  FOR EACH ROW EXECUTE FUNCTION seneschal_block_mutation();

-- NotificationMessage allows status updates from the outbox dispatcher (QUEUED→SENT/FAILED)
-- but never DELETE.
CREATE TRIGGER notification_message_no_delete
  BEFORE DELETE ON "NotificationMessage"
  FOR EACH ROW EXECUTE FUNCTION seneschal_block_mutation();
