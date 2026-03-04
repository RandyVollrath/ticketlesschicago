/**
 * One-time setup endpoint to create the dot_permits table and RPC function.
 *
 * Call this once to set up the database schema.
 * After that, it can be deleted or will just return "already exists".
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.NODE_ENV === 'production' && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  // Check if table already exists
  const { error: checkError } = await supabaseAdmin
    .from('dot_permits')
    .select('id')
    .limit(1);

  if (!checkError) {
    return res.status(200).json({ message: 'dot_permits table already exists' });
  }

  // Table doesn't exist — we can't create it via PostgREST.
  // Return the SQL that needs to be run in the Supabase SQL Editor.
  return res.status(200).json({
    message: 'Please run the migration SQL in the Supabase SQL Editor',
    migrationFile: 'supabase/migrations/20260303_create_dot_permits.sql',
    note: 'Copy the contents of the migration file and paste them into the Supabase SQL Editor at https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql',
  });
}
