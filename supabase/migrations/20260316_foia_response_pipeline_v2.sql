-- FOIA Response Pipeline V2: Reference IDs, Unmatched Queue, History Response Fields
--
-- Adds:
-- 1. reference_id columns on both FOIA tables for reliable response matching
-- 2. foia_unmatched_responses table for admin review of unmatched responses
-- 3. Columns on foia_history_requests for automated response handling

-- ─── 1. Reference IDs for matching ───

-- Evidence FOIA: add reference_id + resend_message_id
ALTER TABLE ticket_foia_requests
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS resend_message_id text;

CREATE INDEX IF NOT EXISTS idx_ticket_foia_requests_reference_id
  ON ticket_foia_requests(reference_id) WHERE reference_id IS NOT NULL;

-- History FOIA: add reference_id + resend_message_id
ALTER TABLE foia_history_requests
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS resend_message_id text;

CREATE INDEX IF NOT EXISTS idx_foia_history_requests_reference_id
  ON foia_history_requests(reference_id) WHERE reference_id IS NOT NULL;

-- ─── 2. Unmatched FOIA response queue ───

CREATE TABLE IF NOT EXISTS foia_unmatched_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email text NOT NULL,
  to_email text,
  subject text,
  body_preview text,           -- First 2000 chars of body
  full_body text,              -- Complete email body for AI parsing
  attachment_count integer DEFAULT 0,
  attachment_metadata jsonb,   -- [{filename, content_type, size}]
  email_headers jsonb,         -- Raw headers for In-Reply-To matching

  -- Matching attempts
  extracted_ticket_number text,
  extracted_plate text,
  extracted_reference_id text,
  match_attempts jsonb,        -- Log of what matching was tried

  -- Resolution
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched_evidence', 'matched_history', 'irrelevant', 'manual_review')),
  matched_foia_request_id uuid,     -- FK to ticket_foia_requests if matched
  matched_history_request_id uuid,  -- FK to foia_history_requests if matched
  resolved_by text,            -- admin user or 'system'
  resolved_at timestamptz,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foia_unmatched_status ON foia_unmatched_responses(status);

-- ─── 3. History FOIA: add parsed response fields for automated handling ───

-- These columns store the AI-parsed ticket data from FOIA history responses
ALTER TABLE foia_history_requests
  ADD COLUMN IF NOT EXISTS parsed_tickets jsonb,     -- [{ticket_number, date, type, amount, status, location}]
  ADD COLUMN IF NOT EXISTS ai_parse_model text,      -- 'gemini-2.0-flash' etc
  ADD COLUMN IF NOT EXISTS ai_parse_raw text,        -- Raw AI response for debugging
  ADD COLUMN IF NOT EXISTS ai_parsed_at timestamptz;

-- RLS: admin only for unmatched queue
ALTER TABLE foia_unmatched_responses ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (cron jobs, webhooks)
CREATE POLICY "service_role_all" ON foia_unmatched_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);
