/**
 * Setup Database for UtilityAPI
 *
 * Adds necessary columns to user_profiles table.
 * Call this once to set up the database.
 *
 * POST /api/utilityapi/setup-database
 * Header: Authorization: Bearer {ADMIN_API_TOKEN}
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check admin token (fail closed if not configured)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  const adminToken = process.env.ADMIN_API_TOKEN;

  if (!adminToken) {
    console.error('ADMIN_API_TOKEN not configured - rejecting request (fail closed)');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (token !== adminToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    console.log('🔧 Setting up database for UtilityAPI...');

    // Check if columns already exist
    const { data: testQuery, error: testError } = await supabase
      .from('user_profiles')
      .select('utilityapi_connected')
      .limit(1);

    if (!testError) {
      console.log('✓ Columns already exist');
      return res.status(200).json({
        success: true,
        message: 'Database columns already exist',
      });
    }

    // If columns don't exist, we need to add them
    // Since Supabase doesn't allow ALTER TABLE via the JS client,
    // you need to run this SQL manually in the Supabase dashboard:

    const sql = `
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS utilityapi_form_uid TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_authorization_uid TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_connected BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS utilityapi_connected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS utilityapi_utility TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_uid TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_pdf_url TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_profiles_utilityapi_auth
ON user_profiles(utilityapi_authorization_uid);
    `.trim();

    return res.status(200).json({
      success: false,
      message: 'Please run this SQL in Supabase dashboard:',
      sql,
    });
  } catch (error: any) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
    });
  }
}
