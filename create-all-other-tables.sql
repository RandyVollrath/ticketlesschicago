-- Create all remaining tables for court records and attorney marketplace
-- Run this in Supabase SQL Editor after court_case_outcomes is created

-- 1. Win rate statistics table
CREATE TABLE IF NOT EXISTS win_rate_statistics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stat_type TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  total_cases INTEGER DEFAULT 0,
  dismissed_count INTEGER DEFAULT 0,
  reduced_count INTEGER DEFAULT 0,
  upheld_count INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2),
  dismissal_rate DECIMAL(5, 2),
  reduction_rate DECIMAL(5, 2),
  avg_reduction_percentage DECIMAL(5, 2),
  avg_days_to_decision DECIMAL(6, 2),
  last_calculated TIMESTAMP WITH TIME ZONE DEFAULT now(),
  sample_size_adequate BOOLEAN DEFAULT false,
  UNIQUE(stat_type, stat_key)
);

-- 2. Attorneys table
CREATE TABLE IF NOT EXISTS attorneys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  law_firm TEXT,
  email TEXT,
  phone TEXT,
  bar_number TEXT,
  bar_state TEXT DEFAULT 'IL',
  years_experience INTEGER,
  specializations TEXT[],
  office_address TEXT,
  service_areas TEXT[],
  accepting_cases BOOLEAN DEFAULT true,
  response_time_hours INTEGER,
  consultation_fee DECIMAL(10, 2),
  flat_fee_parking DECIMAL(10, 2),
  flat_fee_traffic DECIMAL(10, 2),
  hourly_rate DECIMAL(10, 2),
  pricing_model TEXT,
  total_cases_handled INTEGER DEFAULT 0,
  total_cases_won INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2),
  avg_reduction_percentage DECIMAL(5, 2),
  avg_case_duration_days INTEGER,
  total_reviews INTEGER DEFAULT 0,
  average_rating DECIMAL(3, 2),
  bio TEXT,
  profile_photo_url TEXT,
  website_url TEXT,
  linkedin_url TEXT,
  verified BOOLEAN DEFAULT false,
  featured BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Attorney case expertise table
CREATE TABLE IF NOT EXISTS attorney_case_expertise (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attorney_id UUID NOT NULL REFERENCES attorneys(id) ON DELETE CASCADE,
  violation_code TEXT NOT NULL,
  cases_handled INTEGER DEFAULT 0,
  cases_won INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(attorney_id, violation_code)
);

-- 4. Attorney reviews table
CREATE TABLE IF NOT EXISTS attorney_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attorney_id UUID NOT NULL REFERENCES attorneys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
  professionalism_rating INTEGER CHECK (professionalism_rating >= 1 AND professionalism_rating <= 5),
  value_rating INTEGER CHECK (value_rating >= 1 AND value_rating <= 5),
  review_text TEXT,
  case_outcome TEXT,
  would_recommend BOOLEAN,
  verified BOOLEAN DEFAULT false,
  hidden BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. Attorney quote requests table
CREATE TABLE IF NOT EXISTS attorney_quote_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attorney_id UUID NOT NULL REFERENCES attorneys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_phone TEXT,
  violation_code TEXT NOT NULL,
  ticket_amount DECIMAL(10, 2) NOT NULL,
  case_description TEXT NOT NULL,
  urgency TEXT CHECK (urgency IN ('urgent', 'normal', 'not_urgent')),
  preferred_contact TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'responded', 'accepted', 'declined', 'completed')),
  attorney_response TEXT,
  quote_amount DECIMAL(10, 2),
  estimated_duration TEXT,
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. Ticket contests table (if not already created)
CREATE TABLE IF NOT EXISTS ticket_contests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_photo_url TEXT NOT NULL,
  ticket_number TEXT,
  violation_code TEXT,
  violation_description TEXT,
  ticket_date DATE,
  ticket_amount DECIMAL(10, 2),
  ticket_location TEXT,
  license_plate TEXT,
  extracted_data JSONB,
  contest_letter TEXT,
  evidence_checklist JSONB,
  contest_grounds TEXT[],
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'submitted', 'approved', 'denied', 'withdrawn')),
  attorney_requested BOOLEAN DEFAULT false,
  filing_method TEXT CHECK (filing_method IN ('self', 'attorney', 'ticketless')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  submitted_at TIMESTAMP WITH TIME ZONE,
  admin_notes TEXT
);

-- Enable RLS on all tables
ALTER TABLE win_rate_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorneys ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorney_case_expertise ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorney_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorney_quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_contests ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_win_rate_type ON win_rate_statistics(stat_type);
CREATE INDEX IF NOT EXISTS idx_win_rate_key ON win_rate_statistics(stat_key);
CREATE INDEX IF NOT EXISTS idx_attorneys_status ON attorneys(status);
CREATE INDEX IF NOT EXISTS idx_attorneys_verified ON attorneys(verified);
CREATE INDEX IF NOT EXISTS idx_expertise_attorney ON attorney_case_expertise(attorney_id);
CREATE INDEX IF NOT EXISTS idx_expertise_code ON attorney_case_expertise(violation_code);
CREATE INDEX IF NOT EXISTS idx_reviews_attorney ON attorney_reviews(attorney_id);
CREATE INDEX IF NOT EXISTS idx_quotes_attorney ON attorney_quote_requests(attorney_id);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON attorney_quote_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON attorney_quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_contests_user ON ticket_contests(user_id);
CREATE INDEX IF NOT EXISTS idx_contests_status ON ticket_contests(status);

-- Grant permissions
GRANT ALL ON win_rate_statistics TO service_role;
GRANT ALL ON attorneys TO service_role;
GRANT ALL ON attorney_case_expertise TO service_role;
GRANT ALL ON attorney_reviews TO service_role;
GRANT ALL ON attorney_quote_requests TO service_role;
GRANT ALL ON ticket_contests TO service_role;

GRANT SELECT ON win_rate_statistics TO authenticated;
GRANT SELECT ON attorneys TO authenticated;
GRANT SELECT ON attorney_case_expertise TO authenticated;
GRANT ALL ON attorney_reviews TO authenticated;
GRANT ALL ON attorney_quote_requests TO authenticated;
GRANT ALL ON ticket_contests TO authenticated;

-- RLS Policies for ticket_contests
CREATE POLICY "Users can view own contests" ON ticket_contests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own contests" ON ticket_contests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contests" ON ticket_contests
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for attorneys (public read)
CREATE POLICY "Anyone can view active attorneys" ON attorneys
  FOR SELECT TO authenticated
  USING (status = 'active');

-- RLS Policies for attorney_reviews
CREATE POLICY "Anyone can view non-hidden reviews" ON attorney_reviews
  FOR SELECT TO authenticated
  USING (hidden = false);

CREATE POLICY "Users can create own reviews" ON attorney_reviews
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for attorney_quote_requests
CREATE POLICY "Users can view own quote requests" ON attorney_quote_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create quote requests" ON attorney_quote_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create update trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_attorneys_updated_at ON attorneys;
CREATE TRIGGER update_attorneys_updated_at
  BEFORE UPDATE ON attorneys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expertise_updated_at ON attorney_case_expertise;
CREATE TRIGGER update_expertise_updated_at
  BEFORE UPDATE ON attorney_case_expertise
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reviews_updated_at ON attorney_reviews;
CREATE TRIGGER update_reviews_updated_at
  BEFORE UPDATE ON attorney_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quotes_updated_at ON attorney_quote_requests;
CREATE TRIGGER update_quotes_updated_at
  BEFORE UPDATE ON attorney_quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contests_updated_at ON ticket_contests;
CREATE TRIGGER update_contests_updated_at
  BEFORE UPDATE ON ticket_contests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Success message
SELECT 'All tables created successfully!' as status,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('win_rate_statistics', 'attorneys', 'attorney_case_expertise',
                           'attorney_reviews', 'attorney_quote_requests', 'ticket_contests')) as tables_created;
