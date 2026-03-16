/**
 * One-shot migration endpoint for FOIA Response Pipeline V2.
 * Hit this once after deploy to apply DDL changes.
 * Protected by CRON_SECRET.
 * DELETE THIS FILE after migration is applied.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const keyParam = req.query.key as string | undefined;
  if (keyParam !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results: { step: string; status: string }[] = [];

  // Helper: test if a column exists
  async function columnExists(table: string, column: string): Promise<boolean> {
    const { error } = await supabaseAdmin.from(table).select(column).limit(1);
    return !error || !error.message.includes(column);
  }

  // Helper: test if a table exists
  async function tableExists(table: string): Promise<boolean> {
    const { error } = await supabaseAdmin.from(table).select('id').limit(1);
    return !error || !error.message.includes('Could not find');
  }

  // Step 1: Check ticket_foia_requests.reference_id
  if (await columnExists('ticket_foia_requests', 'reference_id')) {
    results.push({ step: 'ticket_foia_requests.reference_id', status: 'already exists' });
  } else {
    results.push({ step: 'ticket_foia_requests.reference_id', status: 'NEEDS MANUAL SQL' });
  }

  // Step 2: Check foia_history_requests.reference_id
  if (await columnExists('foia_history_requests', 'reference_id')) {
    results.push({ step: 'foia_history_requests.reference_id', status: 'already exists' });
  } else {
    results.push({ step: 'foia_history_requests.reference_id', status: 'NEEDS MANUAL SQL' });
  }

  // Step 3: Check foia_history_requests.parsed_tickets
  if (await columnExists('foia_history_requests', 'parsed_tickets')) {
    results.push({ step: 'foia_history_requests.parsed_tickets', status: 'already exists' });
  } else {
    results.push({ step: 'foia_history_requests.parsed_tickets', status: 'NEEDS MANUAL SQL' });
  }

  // Step 4: Check foia_unmatched_responses table
  if (await tableExists('foia_unmatched_responses')) {
    results.push({ step: 'foia_unmatched_responses table', status: 'already exists' });
  } else {
    results.push({ step: 'foia_unmatched_responses table', status: 'NEEDS MANUAL SQL' });
  }

  const needsManual = results.filter(r => r.status === 'NEEDS MANUAL SQL');

  if (needsManual.length > 0) {
    return res.status(200).json({
      message: 'Migration not yet applied. Run this SQL in the Supabase Dashboard:',
      dashboard_url: 'https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql/new',
      sql: `-- FOIA Response Pipeline V2 Migration
-- Copy and paste this entire block into the Supabase SQL Editor

-- 1. Reference IDs for matching
ALTER TABLE ticket_foia_requests
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS resend_message_id text;

CREATE INDEX IF NOT EXISTS idx_ticket_foia_requests_reference_id
  ON ticket_foia_requests(reference_id) WHERE reference_id IS NOT NULL;

ALTER TABLE foia_history_requests
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS resend_message_id text;

CREATE INDEX IF NOT EXISTS idx_foia_history_requests_reference_id
  ON foia_history_requests(reference_id) WHERE reference_id IS NOT NULL;

-- 2. Unmatched FOIA response queue
CREATE TABLE IF NOT EXISTS foia_unmatched_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email text NOT NULL,
  to_email text,
  subject text,
  body_preview text,
  full_body text,
  attachment_count integer DEFAULT 0,
  attachment_metadata jsonb,
  email_headers jsonb,
  extracted_ticket_number text,
  extracted_plate text,
  extracted_reference_id text,
  match_attempts jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched_evidence', 'matched_history', 'irrelevant', 'manual_review')),
  matched_foia_request_id uuid,
  matched_history_request_id uuid,
  resolved_by text,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foia_unmatched_status ON foia_unmatched_responses(status);

ALTER TABLE foia_unmatched_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON foia_unmatched_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. History FOIA parsed response fields
ALTER TABLE foia_history_requests
  ADD COLUMN IF NOT EXISTS parsed_tickets jsonb,
  ADD COLUMN IF NOT EXISTS ai_parse_model text,
  ADD COLUMN IF NOT EXISTS ai_parse_raw text,
  ADD COLUMN IF NOT EXISTS ai_parsed_at timestamptz;
`,
      results,
    });
  }

  return res.status(200).json({
    message: 'All migration steps already applied!',
    results,
  });
}
