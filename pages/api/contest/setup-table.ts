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

  try {
    console.log('Creating ticket_contests table...');

    // First check if table already exists
    const { data: existingData, error: checkError } = await supabase
      .from('ticket_contests')
      .select('id')
      .limit(1);

    if (!checkError) {
      console.log('✅ ticket_contests table already exists!');
      return res.status(200).json({
        success: true,
        message: 'ticket_contests table already exists',
        recordCount: existingData?.length || 0
      });
    }

    // SQL from migration file
    const createTableSQL = `
-- Create ticket_contests table for storing ticket contest submissions
CREATE TABLE IF NOT EXISTS ticket_contests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Ticket information
  ticket_photo_url TEXT NOT NULL,
  ticket_number TEXT,
  violation_code TEXT,
  violation_description TEXT,
  ticket_date DATE,
  ticket_amount DECIMAL(10, 2),
  ticket_location TEXT,
  license_plate TEXT,

  -- Extracted data from OCR/LLM (JSON format)
  extracted_data JSONB,

  -- Contest information
  contest_letter TEXT,
  evidence_checklist JSONB,
  contest_grounds TEXT[],

  -- Status tracking
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'submitted', 'approved', 'denied', 'withdrawn')),

  -- Attorney/filing options
  attorney_requested BOOLEAN DEFAULT false,
  filing_method TEXT CHECK (filing_method IN ('self', 'attorney', 'ticketless')),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  submitted_at TIMESTAMP WITH TIME ZONE,

  -- Admin notes
  admin_notes TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS ticket_contests_user_id_idx ON ticket_contests(user_id);
CREATE INDEX IF NOT EXISTS ticket_contests_status_idx ON ticket_contests(status);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_ticket_contests_updated_at()
RETURNS TRIGGER AS \$\$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
\$\$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_contests_updated_at
  BEFORE UPDATE ON ticket_contests
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_contests_updated_at();

-- Enable RLS
ALTER TABLE ticket_contests ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own contests"
  ON ticket_contests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own contests"
  ON ticket_contests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contests"
  ON ticket_contests FOR UPDATE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON ticket_contests TO authenticated;
GRANT ALL ON ticket_contests TO service_role;
    `;

    console.log('Table does not exist, providing SQL for manual execution');
    return res.status(200).json({
      success: false,
      message: 'Table creation requires manual SQL execution',
      sql: createTableSQL,
      instructions: 'Please run this SQL in the Supabase SQL Editor'
    });

  } catch (error: any) {
    console.error('Setup error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
