-- Court Records Scraper System
-- Stores historical parking ticket court outcomes for win probability modeling

-- Court case outcomes table
CREATE TABLE IF NOT EXISTS court_case_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Case identification
  case_number TEXT,
  ticket_number TEXT,

  -- Violation details
  violation_code TEXT NOT NULL,
  violation_description TEXT,
  ticket_amount DECIMAL(10, 2),

  -- Location data
  ticket_location TEXT,
  ward TEXT,
  court_location TEXT,

  -- Outcome data
  outcome TEXT CHECK (outcome IN ('dismissed', 'reduced', 'upheld', 'withdrawn', 'pending')),
  original_amount DECIMAL(10, 2),
  final_amount DECIMAL(10, 2),
  reduction_percentage DECIMAL(5, 2),

  -- Contest details
  contest_grounds TEXT[],
  defense_strategy TEXT,
  evidence_submitted JSONB, -- {photos: boolean, witnesses: boolean, documentation: boolean}
  attorney_represented BOOLEAN DEFAULT false,

  -- Temporal data
  ticket_date DATE,
  contest_filed_date DATE,
  hearing_date DATE,
  decision_date DATE,
  days_to_decision INTEGER,

  -- Judicial info
  judge_name TEXT,
  hearing_officer_name TEXT,

  -- Metadata
  data_source TEXT, -- 'manual', 'scraped', 'user_reported'
  scrape_date TIMESTAMP WITH TIME ZONE,
  verified BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS court_outcomes_violation_code_idx ON court_case_outcomes(violation_code);
CREATE INDEX IF NOT EXISTS court_outcomes_outcome_idx ON court_case_outcomes(outcome);
CREATE INDEX IF NOT EXISTS court_outcomes_ward_idx ON court_case_outcomes(ward);
CREATE INDEX IF NOT EXISTS court_outcomes_judge_idx ON court_case_outcomes(judge_name);
CREATE INDEX IF NOT EXISTS court_outcomes_ticket_date_idx ON court_case_outcomes(ticket_date);
CREATE INDEX IF NOT EXISTS court_outcomes_decision_date_idx ON court_case_outcomes(decision_date);

-- Win rate statistics (materialized view for performance)
CREATE TABLE IF NOT EXISTS win_rate_statistics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Dimension
  stat_type TEXT NOT NULL, -- 'violation_code', 'ward', 'judge', 'contest_ground', 'month', 'evidence_type'
  stat_key TEXT NOT NULL, -- The actual value (e.g., '9-64-010', 'Ward 43', 'Judge Smith')

  -- Statistics
  total_cases INTEGER DEFAULT 0,
  dismissed_count INTEGER DEFAULT 0,
  reduced_count INTEGER DEFAULT 0,
  upheld_count INTEGER DEFAULT 0,

  win_rate DECIMAL(5, 2), -- (dismissed + reduced) / total
  dismissal_rate DECIMAL(5, 2), -- dismissed / total
  reduction_rate DECIMAL(5, 2), -- reduced / total

  avg_reduction_percentage DECIMAL(5, 2),
  avg_days_to_decision DECIMAL(6, 2),

  -- Metadata
  last_calculated TIMESTAMP WITH TIME ZONE DEFAULT now(),
  sample_size_adequate BOOLEAN DEFAULT false, -- true if total_cases >= 30

  UNIQUE(stat_type, stat_key)
);

CREATE INDEX IF NOT EXISTS win_rate_stats_type_idx ON win_rate_statistics(stat_type);
CREATE INDEX IF NOT EXISTS win_rate_stats_key_idx ON win_rate_statistics(stat_key);

-- Attorney marketplace
CREATE TABLE IF NOT EXISTS attorneys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Basic info
  full_name TEXT NOT NULL,
  law_firm TEXT,
  email TEXT,
  phone TEXT,

  -- Professional details
  bar_number TEXT,
  bar_state TEXT DEFAULT 'IL',
  years_experience INTEGER,
  specializations TEXT[], -- e.g., ['parking_tickets', 'traffic_violations', 'municipal_law']

  -- Location
  office_address TEXT,
  service_areas TEXT[], -- e.g., ['Downtown', 'North Side', 'Cook County']

  -- Availability
  accepting_cases BOOLEAN DEFAULT true,
  response_time_hours INTEGER, -- Average response time

  -- Pricing
  consultation_fee DECIMAL(10, 2),
  flat_fee_parking DECIMAL(10, 2),
  flat_fee_traffic DECIMAL(10, 2),
  hourly_rate DECIMAL(10, 2),
  pricing_model TEXT, -- 'flat_fee', 'hourly', 'contingency', 'hybrid'

  -- Performance metrics
  total_cases_handled INTEGER DEFAULT 0,
  total_cases_won INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2),
  avg_reduction_percentage DECIMAL(5, 2),
  avg_case_duration_days INTEGER,

  -- Reviews
  total_reviews INTEGER DEFAULT 0,
  average_rating DECIMAL(3, 2), -- 0.00 to 5.00

  -- Profile
  bio TEXT,
  profile_photo_url TEXT,
  website_url TEXT,
  linkedin_url TEXT,

  -- Platform status
  verified BOOLEAN DEFAULT false,
  featured BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attorneys_accepting_cases_idx ON attorneys(accepting_cases);
CREATE INDEX IF NOT EXISTS attorneys_specializations_idx ON attorneys USING GIN(specializations);
CREATE INDEX IF NOT EXISTS attorneys_win_rate_idx ON attorneys(win_rate);

-- Attorney case types and expertise
CREATE TABLE IF NOT EXISTS attorney_case_expertise (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attorney_id UUID REFERENCES attorneys(id) ON DELETE CASCADE,

  violation_code TEXT NOT NULL,
  cases_handled INTEGER DEFAULT 0,
  cases_won INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  UNIQUE(attorney_id, violation_code)
);

CREATE INDEX IF NOT EXISTS attorney_expertise_attorney_idx ON attorney_case_expertise(attorney_id);
CREATE INDEX IF NOT EXISTS attorney_expertise_violation_idx ON attorney_case_expertise(violation_code);

-- Attorney reviews
CREATE TABLE IF NOT EXISTS attorney_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attorney_id UUID REFERENCES attorneys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES ticket_contests(id) ON DELETE SET NULL,

  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,

  -- Specific ratings
  communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
  professionalism_rating INTEGER CHECK (professionalism_rating >= 1 AND professionalism_rating <= 5),
  value_rating INTEGER CHECK (value_rating >= 1 AND value_rating <= 5),

  -- Case outcome
  case_outcome TEXT CHECK (case_outcome IN ('dismissed', 'reduced', 'upheld', 'withdrawn')),
  would_recommend BOOLEAN,

  -- Moderation
  verified_client BOOLEAN DEFAULT false,
  flagged BOOLEAN DEFAULT false,
  hidden BOOLEAN DEFAULT false,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attorney_reviews_attorney_idx ON attorney_reviews(attorney_id);
CREATE INDEX IF NOT EXISTS attorney_reviews_rating_idx ON attorney_reviews(rating);

-- Attorney quote requests
CREATE TABLE IF NOT EXISTS attorney_quote_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES ticket_contests(id) ON DELETE CASCADE,
  attorney_id UUID REFERENCES attorneys(id) ON DELETE CASCADE,

  -- Request details
  violation_code TEXT,
  ticket_amount DECIMAL(10, 2),
  description TEXT,
  urgency TEXT CHECK (urgency IN ('low', 'medium', 'high')),
  preferred_contact TEXT, -- 'email', 'phone', 'both'

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'attorney_viewed', 'quote_provided', 'accepted', 'declined', 'expired')),

  -- Quote
  quoted_amount DECIMAL(10, 2),
  quote_details TEXT,
  quote_expires_at TIMESTAMP WITH TIME ZONE,

  -- Response tracking
  attorney_viewed_at TIMESTAMP WITH TIME ZONE,
  quote_provided_at TIMESTAMP WITH TIME ZONE,
  user_responded_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_requests_user_idx ON attorney_quote_requests(user_id);
CREATE INDEX IF NOT EXISTS quote_requests_attorney_idx ON attorney_quote_requests(attorney_id);
CREATE INDEX IF NOT EXISTS quote_requests_status_idx ON attorney_quote_requests(status);

-- Enable RLS
ALTER TABLE court_case_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE win_rate_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorneys ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorney_case_expertise ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorney_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorney_quote_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Court outcomes: Read-only for authenticated users
CREATE POLICY "Anyone can view court outcomes"
  ON court_case_outcomes FOR SELECT
  TO authenticated
  USING (true);

-- Win rate statistics: Read-only for authenticated users
CREATE POLICY "Anyone can view win rate statistics"
  ON win_rate_statistics FOR SELECT
  TO authenticated
  USING (true);

-- Attorneys: Anyone can view active attorneys
CREATE POLICY "Anyone can view active attorneys"
  ON attorneys FOR SELECT
  TO authenticated
  USING (status = 'active');

-- Attorney expertise: Anyone can view
CREATE POLICY "Anyone can view attorney expertise"
  ON attorney_case_expertise FOR SELECT
  TO authenticated
  USING (true);

-- Attorney reviews: Anyone can view non-hidden reviews
CREATE POLICY "Anyone can view reviews"
  ON attorney_reviews FOR SELECT
  TO authenticated
  USING (hidden = false);

-- Users can create their own reviews
CREATE POLICY "Users can create own reviews"
  ON attorney_reviews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Quote requests: Users can view their own
CREATE POLICY "Users can view own quote requests"
  ON attorney_quote_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can create their own quote requests
CREATE POLICY "Users can create quote requests"
  ON attorney_quote_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Grant permissions
GRANT SELECT ON court_case_outcomes TO authenticated;
GRANT SELECT ON win_rate_statistics TO authenticated;
GRANT SELECT ON attorneys TO authenticated;
GRANT SELECT ON attorney_case_expertise TO authenticated;
GRANT ALL ON attorney_reviews TO authenticated;
GRANT ALL ON attorney_quote_requests TO authenticated;

GRANT ALL ON court_case_outcomes TO service_role;
GRANT ALL ON win_rate_statistics TO service_role;
GRANT ALL ON attorneys TO service_role;
GRANT ALL ON attorney_case_expertise TO service_role;
GRANT ALL ON attorney_reviews TO service_role;
GRANT ALL ON attorney_quote_requests TO service_role;

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_court_outcomes_updated_at
  BEFORE UPDATE ON court_case_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attorneys_updated_at
  BEFORE UPDATE ON attorneys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attorney_reviews_updated_at
  BEFORE UPDATE ON attorney_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quote_requests_updated_at
  BEFORE UPDATE ON attorney_quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
