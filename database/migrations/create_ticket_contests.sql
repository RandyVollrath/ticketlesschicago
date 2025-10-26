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
  contest_grounds TEXT[], -- Array of grounds for contesting (e.g., 'signage_unclear', 'incorrect_violation', 'exempt_status')

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

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS ticket_contests_user_id_idx ON ticket_contests(user_id);

-- Create index on status for admin filtering
CREATE INDEX IF NOT EXISTS ticket_contests_status_idx ON ticket_contests(status);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_ticket_contests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_contests_updated_at
  BEFORE UPDATE ON ticket_contests
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_contests_updated_at();

-- Enable RLS
ALTER TABLE ticket_contests ENABLE ROW LEVEL SECURITY;

-- Users can view their own contests
CREATE POLICY "Users can view own contests"
  ON ticket_contests FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own contests
CREATE POLICY "Users can create own contests"
  ON ticket_contests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own contests (except admin_notes)
CREATE POLICY "Users can update own contests"
  ON ticket_contests FOR UPDATE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON ticket_contests TO authenticated;
GRANT ALL ON ticket_contests TO service_role;
