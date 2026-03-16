/**
 * One-shot migration endpoint for FOIA Response Pipeline V2.
 * Hit this once after deploy to apply DDL changes.
 * Protected by CRON_SECRET.
 * DELETE THIS FILE after migration is applied.
 *
 * Mode:
 *   ?key=...          → Check status only
 *   ?key=...&apply=1  → Actually run the DDL via Supabase Management API
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MIGRATION_SQL = `
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
CREATE POLICY IF NOT EXISTS "service_role_all" ON foia_unmatched_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. History FOIA parsed response fields
ALTER TABLE foia_history_requests
  ADD COLUMN IF NOT EXISTS parsed_tickets jsonb,
  ADD COLUMN IF NOT EXISTS ai_parse_model text,
  ADD COLUMN IF NOT EXISTS ai_parse_raw text,
  ADD COLUMN IF NOT EXISTS ai_parsed_at timestamptz;
`.trim();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const keyParam = req.query.key as string | undefined;
  if (keyParam !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const shouldApply = req.query.apply === '1';
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

  // Check current state
  const checks = [
    { step: 'ticket_foia_requests.reference_id', table: 'ticket_foia_requests', col: 'reference_id' },
    { step: 'foia_history_requests.reference_id', table: 'foia_history_requests', col: 'reference_id' },
    { step: 'foia_history_requests.parsed_tickets', table: 'foia_history_requests', col: 'parsed_tickets' },
  ];

  for (const check of checks) {
    const exists = await columnExists(check.table, check.col);
    results.push({ step: check.step, status: exists ? 'already exists' : 'NEEDS MIGRATION' });
  }

  const tableCheck = await tableExists('foia_unmatched_responses');
  results.push({ step: 'foia_unmatched_responses table', status: tableCheck ? 'already exists' : 'NEEDS MIGRATION' });

  const needsMigration = results.some(r => r.status === 'NEEDS MIGRATION');

  if (!needsMigration) {
    return res.status(200).json({ message: 'All migration steps already applied!', results });
  }

  if (!shouldApply) {
    return res.status(200).json({
      message: 'Migration needed. Add &apply=1 to execute, or paste SQL into Supabase Dashboard.',
      dashboard_url: 'https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql/new',
      sql: MIGRATION_SQL,
      results,
    });
  }

  // ─── Execute migration via Supabase Management API ───
  // The service role key can't run DDL. We need the Management API with a personal access token,
  // OR we execute each statement individually via a helper.
  // Approach: Split SQL into statements and execute them via individual API calls.

  // Split SQL into individual statements
  const statements = MIGRATION_SQL
    .split(';')
    .map(s => s.replace(/--[^\n]*/g, '').trim())
    .filter(s => s.length > 5);

  const execResults: { sql: string; status: string; error?: string }[] = [];

  for (const stmt of statements) {
    try {
      // Use the Supabase service role's RPC to execute raw SQL via a pg function
      // We'll create the function first, then use it
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        body: JSON.stringify({ sql_string: stmt }),
      });

      if (response.ok) {
        execResults.push({ sql: stmt.substring(0, 80) + '...', status: 'OK' });
      } else {
        const errText = await response.text();
        if (errText.includes('Could not find the function')) {
          // exec_sql function doesn't exist - need to create it first
          execResults.push({ sql: 'exec_sql function', status: 'NOT FOUND - creating...' });

          // Create the exec_sql function using a bootstrapping approach
          // We'll use the Supabase SQL endpoint from the dashboard API
          return res.status(200).json({
            message: 'exec_sql function not found. Paste this SQL into Supabase Dashboard first, then retry with &apply=1:',
            dashboard_url: 'https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql/new',
            bootstrap_sql: `CREATE OR REPLACE FUNCTION exec_sql(query text) RETURNS void AS $$ BEGIN EXECUTE query; END; $$ LANGUAGE plpgsql SECURITY DEFINER;`,
            migration_sql: MIGRATION_SQL,
            results,
          });
        }
        execResults.push({ sql: stmt.substring(0, 80) + '...', status: 'ERROR', error: errText.substring(0, 200) });
      }
    } catch (err: any) {
      execResults.push({ sql: stmt.substring(0, 80) + '...', status: 'EXCEPTION', error: err.message });
    }
  }

  // Re-check
  const postResults: { step: string; status: string }[] = [];
  for (const check of checks) {
    const exists = await columnExists(check.table, check.col);
    postResults.push({ step: check.step, status: exists ? 'OK' : 'STILL MISSING' });
  }
  const tblExists = await tableExists('foia_unmatched_responses');
  postResults.push({ step: 'foia_unmatched_responses table', status: tblExists ? 'OK' : 'STILL MISSING' });

  return res.status(200).json({
    message: 'Migration execution attempted',
    execResults,
    postCheck: postResults,
  });
}
