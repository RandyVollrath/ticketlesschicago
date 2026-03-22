import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

/**
 * One-time migration endpoint to add FOIA integration tracking columns.
 * Runs ALTER TABLE via a temporary RPC function (since PostgREST doesn't support DDL).
 *
 * Call: GET /api/admin/apply-foia-migration?key=CRON_SECRET
 * DELETE THIS FILE after migration has been applied.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const keyParam = req.query.key as string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && keyParam !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const results: string[] = [];

  // Check if columns already exist
  const { error: testError } = await sb
    .from('contest_letters')
    .select('cdot_foia_integrated')
    .limit(1);

  if (!testError) {
    results.push('Columns already exist - no migration needed');
    return res.status(200).json({ success: true, results });
  }

  results.push('Columns do not exist yet. Applying migration...');

  // Use the Supabase Management API to run DDL
  // We need the project's database password or management API token
  // Since we're running on Vercel, we'll use a workaround:
  // Create a temporary RPC function, call it, then drop it

  // The Management API approach (needs SUPABASE_ACCESS_TOKEN)
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (accessToken) {
    const projectRef = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
    if (!projectRef) {
      return res.status(500).json({ error: 'Could not extract project ref from URL' });
    }

    const sql = `
      ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS cdot_foia_integrated boolean DEFAULT false;
      ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS cdot_foia_integrated_at timestamptz;
      ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS cdot_foia_notes text;
      ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS finance_foia_integrated boolean DEFAULT false;
      ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS finance_foia_integrated_at timestamptz;
      ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS finance_foia_notes text;
    `;

    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    if (response.ok) {
      results.push('Migration applied successfully via Management API');
      return res.status(200).json({ success: true, results });
    } else {
      const text = await response.text();
      results.push(`Management API error ${response.status}: ${text}`);
    }
  }

  // Fallback: provide manual instructions
  results.push('SUPABASE_ACCESS_TOKEN not set. Please run this SQL in the Supabase Dashboard SQL Editor:');
  results.push('https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql/new');
  results.push('');
  results.push('ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS cdot_foia_integrated boolean DEFAULT false;');
  results.push('ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS cdot_foia_integrated_at timestamptz;');
  results.push('ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS cdot_foia_notes text;');
  results.push('ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS finance_foia_integrated boolean DEFAULT false;');
  results.push('ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS finance_foia_integrated_at timestamptz;');
  results.push('ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS finance_foia_notes text;');

  return res.status(200).json({ success: false, results });
}
