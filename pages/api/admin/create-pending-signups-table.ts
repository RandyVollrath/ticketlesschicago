import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // First check if table exists by trying to query it
    const { error: checkError } = await supabase
      .from('pending_signups')
      .select('id')
      .limit(1);

    if (!checkError) {
      return res.status(200).json({
        success: true,
        message: 'Table already exists'
      });
    }

    // Table doesn't exist - need to create it via SQL editor
    return res.status(200).json({
      success: false,
      message: 'Please run this SQL in Supabase SQL Editor',
      sql: `
-- Create pending_signups table to store form data before authentication
CREATE TABLE IF NOT EXISTS pending_signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  license_plate TEXT,
  address TEXT,
  zip TEXT,
  vin TEXT,
  make TEXT,
  model TEXT,
  city_sticker TEXT,
  token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Create index on email for fast lookups
CREATE INDEX IF NOT EXISTS idx_pending_signups_email ON pending_signups(email);

-- Create index on expires_at for cleanup
CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at);

-- Enable RLS
ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything
CREATE POLICY "Service role has full access to pending_signups" ON pending_signups
  FOR ALL USING (true);

COMMENT ON TABLE pending_signups IS 'Temporary storage for signup form data before user authenticates';
      `
    });

  } catch (error: any) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
