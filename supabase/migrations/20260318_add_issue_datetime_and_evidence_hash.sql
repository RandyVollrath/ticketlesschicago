-- Add issue_datetime column to detected_tickets
-- Preserves the full ISO timestamp from the Chicago portal API (e.g. "2026-02-07T21:07:00")
-- Used for correlating red-light camera violations with app-captured receipt timestamps
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS issue_datetime TIMESTAMPTZ;

-- Add evidence_hash column to red_light_receipts
-- SHA-256 hash of raw evidence data computed at capture time for chain-of-custody integrity
ALTER TABLE red_light_receipts ADD COLUMN IF NOT EXISTS evidence_hash TEXT;
ALTER TABLE red_light_receipts ADD COLUMN IF NOT EXISTS evidence_hash_algorithm TEXT DEFAULT 'sha256';
ALTER TABLE red_light_receipts ADD COLUMN IF NOT EXISTS evidence_hashed_at TIMESTAMPTZ;
