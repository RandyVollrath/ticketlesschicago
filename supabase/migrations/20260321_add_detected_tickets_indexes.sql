-- Add indexes on detected_tickets for common query patterns
-- user_id: used by nearly every API endpoint that filters tickets by user
-- status partial index: used by reminder crons, mail crons, and generate crons

CREATE INDEX IF NOT EXISTS idx_detected_tickets_user_id
  ON detected_tickets (user_id);

CREATE INDEX IF NOT EXISTS idx_detected_tickets_pending_status
  ON detected_tickets (status)
  WHERE status IN ('pending_evidence', 'needs_approval', 'found', 'letter_generated', 'approved');
