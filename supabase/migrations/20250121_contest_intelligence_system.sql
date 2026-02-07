-- Contest Intelligence System Migration
-- Adds tables for ward intelligence, evidence analysis, hearing officer patterns,
-- signage database, letter scoring, outcome learning, and tow alerts

-- ============================================
-- 1. WARD-SPECIFIC INTELLIGENCE
-- ============================================

-- Enhanced ward statistics with detailed metrics
CREATE TABLE IF NOT EXISTS ward_contest_intelligence (
  ward INTEGER PRIMARY KEY,
  ward_name TEXT,
  alderman_name TEXT,

  -- Overall stats
  total_contests INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  overall_win_rate DECIMAL(5,2) DEFAULT 0,

  -- By violation type (JSONB for flexibility)
  -- Format: { "street_cleaning": { "contests": 100, "wins": 45, "win_rate": 0.45 }, ... }
  violation_stats JSONB DEFAULT '{}',

  -- By defense type
  -- Format: { "signage": { "contests": 50, "wins": 30, "win_rate": 0.60 }, "weather": {...} }
  defense_stats JSONB DEFAULT '{}',

  -- Best arguments for this ward
  -- Format: [{ "argument_type": "signage", "win_rate": 0.65, "sample_size": 100 }, ...]
  top_arguments JSONB DEFAULT '[]',

  -- Seasonal patterns
  -- Format: { "winter": { "win_rate": 0.40 }, "summer": { "win_rate": 0.35 } }
  seasonal_patterns JSONB DEFAULT '{}',

  -- Average processing times
  avg_days_to_decision DECIMAL(5,1),
  avg_fine_amount DECIMAL(10,2),

  -- Enforcement intensity (tickets per capita)
  enforcement_score DECIMAL(5,2),

  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_ward_intelligence_win_rate ON ward_contest_intelligence(overall_win_rate DESC);

-- ============================================
-- 2. HEARING OFFICER PATTERN ANALYSIS
-- ============================================

CREATE TABLE IF NOT EXISTS hearing_officer_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id TEXT NOT NULL,
  officer_name TEXT,

  -- Overall stats
  total_cases INTEGER DEFAULT 0,
  total_dismissals INTEGER DEFAULT 0,
  total_upheld INTEGER DEFAULT 0,
  overall_dismissal_rate DECIMAL(5,2) DEFAULT 0,

  -- By violation type
  -- Format: { "street_cleaning": { "cases": 50, "dismissed": 25, "rate": 0.50 }, ... }
  violation_patterns JSONB DEFAULT '{}',

  -- By defense type (what arguments work with this officer)
  -- Format: { "signage": { "presented": 30, "accepted": 20, "rate": 0.67 }, ... }
  defense_acceptance JSONB DEFAULT '{}',

  -- Evidence preferences (what evidence types this officer responds to)
  -- Format: { "photos": 0.75, "receipts": 0.80, "witness_statements": 0.60 }
  evidence_preferences JSONB DEFAULT '{}',

  -- Tendencies
  tends_toward TEXT CHECK (tends_toward IN ('lenient', 'strict', 'neutral')),
  strictness_score DECIMAL(3,2), -- 0-1, higher = stricter

  -- Time patterns
  avg_hearing_duration_minutes INTEGER,
  prefers_detailed_evidence BOOLEAN DEFAULT true,

  -- Notes from patterns
  pattern_notes TEXT[],

  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(officer_id)
);

CREATE INDEX IF NOT EXISTS idx_officer_patterns_dismissal ON hearing_officer_patterns(overall_dismissal_rate DESC);
CREATE INDEX IF NOT EXISTS idx_officer_patterns_id ON hearing_officer_patterns(officer_id);

-- ============================================
-- 3. SIGNAGE DATABASE
-- ============================================

CREATE TABLE IF NOT EXISTS signage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Location
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  address TEXT,
  ward INTEGER,

  -- Sign details
  sign_type TEXT NOT NULL, -- 'street_cleaning', 'no_parking', 'permit_zone', 'loading_zone', etc.
  sign_text TEXT, -- Actual text on sign
  restriction_hours TEXT, -- e.g., "7AM-9AM MON-FRI"

  -- Condition
  condition TEXT CHECK (condition IN ('good', 'faded', 'damaged', 'obscured', 'missing')),
  obstruction_type TEXT, -- 'tree', 'graffiti', 'snow', 'other'

  -- Photos
  photo_urls TEXT[],

  -- Verification
  reported_by UUID REFERENCES auth.users(id),
  verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,

  -- For contests
  used_in_contests INTEGER DEFAULT 0,
  contest_win_rate DECIMAL(5,2),

  -- Google Street View reference
  street_view_url TEXT,
  street_view_date DATE,

  last_verified TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Spatial index for location queries
CREATE INDEX IF NOT EXISTS idx_signage_location ON signage_reports(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_signage_ward ON signage_reports(ward);
CREATE INDEX IF NOT EXISTS idx_signage_type ON signage_reports(sign_type);
CREATE INDEX IF NOT EXISTS idx_signage_condition ON signage_reports(condition);

-- ============================================
-- 4. LETTER QUALITY SCORING
-- ============================================

CREATE TABLE IF NOT EXISTS letter_quality_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id UUID REFERENCES contest_letters(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES detected_tickets(id) ON DELETE CASCADE,

  -- Overall score
  overall_score INTEGER CHECK (overall_score >= 0 AND overall_score <= 100),

  -- Component scores (0-100 each)
  argument_strength INTEGER,
  evidence_quality INTEGER,
  legal_accuracy INTEGER,
  personalization INTEGER,
  completeness INTEGER,

  -- Detailed breakdown
  -- Format: { "has_signage_defense": true, "has_weather_data": false, ... }
  score_breakdown JSONB DEFAULT '{}',

  -- What could improve the score
  -- Format: [{ "action": "Add photo of signage", "potential_boost": 15 }, ...]
  improvement_suggestions JSONB DEFAULT '[]',

  -- Predicted outcome
  predicted_win_probability DECIMAL(5,2),
  confidence_level DECIMAL(5,2),

  -- Comparison to similar cases
  percentile_rank INTEGER, -- How this letter ranks vs similar violation type

  scored_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_letter_scores_overall ON letter_quality_scores(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_letter_scores_letter ON letter_quality_scores(letter_id);
CREATE INDEX IF NOT EXISTS idx_letter_scores_ticket ON letter_quality_scores(ticket_id);

-- ============================================
-- 5. OUTCOME LEARNING / FEEDBACK LOOP
-- ============================================

CREATE TABLE IF NOT EXISTS contest_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES detected_tickets(id) ON DELETE CASCADE,
  letter_id UUID REFERENCES contest_letters(id),
  user_id UUID REFERENCES auth.users(id),

  -- Outcome
  outcome TEXT NOT NULL CHECK (outcome IN ('dismissed', 'reduced', 'upheld', 'default_judgment', 'continued', 'unknown')),
  outcome_date DATE,

  -- Original vs final
  original_amount DECIMAL(10,2),
  final_amount DECIMAL(10,2),
  amount_saved DECIMAL(10,2) GENERATED ALWAYS AS (COALESCE(original_amount, 0) - COALESCE(final_amount, 0)) STORED,

  -- What was used
  violation_type TEXT,
  violation_code TEXT,
  ward INTEGER,

  -- Defense details
  primary_defense TEXT,
  secondary_defenses TEXT[],
  weather_defense_used BOOLEAN DEFAULT false,

  -- Evidence used
  evidence_types TEXT[], -- ['photo', 'receipt', 'witness', 'app_screenshot']
  evidence_count INTEGER,

  -- Hearing details
  hearing_type TEXT, -- 'written', 'administrative', 'court'
  hearing_officer_id TEXT,
  hearing_date DATE,

  -- Learning metrics
  letter_quality_score INTEGER,
  predicted_win_probability DECIMAL(5,2),
  actual_outcome_matches_prediction BOOLEAN,

  -- User feedback
  user_satisfaction INTEGER CHECK (user_satisfaction >= 1 AND user_satisfaction <= 5),
  user_feedback TEXT,

  -- For ML training
  feature_vector JSONB, -- Normalized features for model training

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON contest_outcomes(outcome);
CREATE INDEX IF NOT EXISTS idx_outcomes_violation ON contest_outcomes(violation_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_ward ON contest_outcomes(ward);
CREATE INDEX IF NOT EXISTS idx_outcomes_defense ON contest_outcomes(primary_defense);
CREATE INDEX IF NOT EXISTS idx_outcomes_date ON contest_outcomes(outcome_date DESC);

-- Aggregated learning stats (updated by trigger)
CREATE TABLE IF NOT EXISTS learning_stats (
  id TEXT PRIMARY KEY, -- e.g., 'violation:street_cleaning', 'defense:signage', 'ward:44'
  category TEXT NOT NULL, -- 'violation', 'defense', 'ward', 'officer', 'evidence'
  subcategory TEXT NOT NULL, -- specific value

  total_cases INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,

  current_win_rate DECIMAL(5,2),
  previous_win_rate DECIMAL(5,2),
  win_rate_trend TEXT CHECK (win_rate_trend IN ('up', 'down', 'stable')),

  -- Time-based metrics
  last_30_days_cases INTEGER DEFAULT 0,
  last_30_days_win_rate DECIMAL(5,2),

  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_category ON learning_stats(category, subcategory);

-- ============================================
-- 6. TOW/BOOT ALERT INTEGRATION
-- ============================================

CREATE TABLE IF NOT EXISTS tow_boot_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),

  -- Alert type
  alert_type TEXT NOT NULL CHECK (alert_type IN ('tow', 'boot', 'impound')),

  -- Vehicle info (denormalized for quick access)
  plate TEXT NOT NULL,
  state TEXT DEFAULT 'IL',

  -- Location
  tow_location TEXT, -- Where vehicle was towed from
  impound_location TEXT, -- Where vehicle is now
  impound_address TEXT,
  impound_phone TEXT,

  -- Timing
  tow_date TIMESTAMP WITH TIME ZONE,
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Associated tickets
  related_ticket_ids UUID[],
  total_ticket_amount DECIMAL(10,2),
  tow_fee DECIMAL(10,2),
  daily_storage_fee DECIMAL(10,2),
  boot_fee DECIMAL(10,2),
  total_fees DECIMAL(10,2),

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'vehicle_retrieved', 'contested')),

  -- Contest info
  contesting_tow BOOLEAN DEFAULT false,
  tow_contest_filed_at TIMESTAMP WITH TIME ZONE,
  tow_contest_outcome TEXT,

  -- Notifications
  user_notified BOOLEAN DEFAULT false,
  notified_at TIMESTAMP WITH TIME ZONE,
  notification_method TEXT, -- 'email', 'sms', 'push'

  -- Resolution
  resolved_at TIMESTAMP WITH TIME ZONE,
  amount_paid DECIMAL(10,2),
  amount_waived DECIMAL(10,2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tow_alerts_user ON tow_boot_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_tow_alerts_plate ON tow_boot_alerts(plate, state);
CREATE INDEX IF NOT EXISTS idx_tow_alerts_status ON tow_boot_alerts(status);
CREATE INDEX IF NOT EXISTS idx_tow_alerts_date ON tow_boot_alerts(tow_date DESC);

-- ============================================
-- 7. EVIDENCE ANALYSIS RESULTS
-- ============================================

CREATE TABLE IF NOT EXISTS evidence_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES detected_tickets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),

  -- Evidence item details
  evidence_type TEXT NOT NULL, -- 'photo', 'screenshot', 'document', 'receipt', 'video'
  file_url TEXT,
  file_name TEXT,

  -- OCR/Analysis results
  extracted_text TEXT,
  extracted_data JSONB, -- Structured data from OCR/analysis

  -- Classification
  evidence_category TEXT, -- 'parking_payment', 'renewal_proof', 'signage_photo', 'location_proof', etc.
  relevance_score DECIMAL(5,2), -- How relevant to the defense (0-1)
  quality_score DECIMAL(5,2), -- Image/doc quality (0-1)

  -- For parking payment screenshots
  payment_app TEXT, -- 'ParkChicago', 'SpotHero', etc.
  payment_time TIMESTAMP WITH TIME ZONE,
  payment_zone TEXT,
  payment_amount DECIMAL(10,2),
  session_start TIMESTAMP WITH TIME ZONE,
  session_end TIMESTAMP WITH TIME ZONE,

  -- For renewal receipts
  renewal_type TEXT, -- 'city_sticker', 'registration', 'permit'
  renewal_date DATE,
  effective_date DATE,
  confirmation_number TEXT,

  -- For signage photos
  sign_readable BOOLEAN,
  sign_condition TEXT,
  sign_obstruction TEXT,

  -- Validation
  validates_defense BOOLEAN,
  validation_notes TEXT,

  -- Auto-generated summary
  analysis_summary TEXT,

  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_ticket ON evidence_analysis(ticket_id);
CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence_analysis(evidence_type);
CREATE INDEX IF NOT EXISTS idx_evidence_category ON evidence_analysis(evidence_category);

-- ============================================
-- 8. SUCCESS METRICS DASHBOARD DATA
-- ============================================

CREATE TABLE IF NOT EXISTS platform_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,

  -- Contest metrics
  total_contests_filed INTEGER DEFAULT 0,
  contests_won INTEGER DEFAULT 0,
  contests_lost INTEGER DEFAULT 0,
  contests_pending INTEGER DEFAULT 0,

  -- Financial metrics
  total_fines_contested DECIMAL(12,2) DEFAULT 0,
  total_savings DECIMAL(12,2) DEFAULT 0,
  average_savings_per_win DECIMAL(10,2),

  -- Win rates by category
  win_rates_by_violation JSONB DEFAULT '{}',
  win_rates_by_ward JSONB DEFAULT '{}',
  win_rates_by_defense JSONB DEFAULT '{}',

  -- User metrics
  active_users INTEGER DEFAULT 0,
  new_users INTEGER DEFAULT 0,
  tickets_per_user DECIMAL(5,2),

  -- Letter metrics
  letters_generated INTEGER DEFAULT 0,
  letters_mailed INTEGER DEFAULT 0,
  letters_delivered INTEGER DEFAULT 0,

  -- Evidence metrics
  evidence_submitted INTEGER DEFAULT 0,
  avg_evidence_per_contest DECIMAL(5,2),

  -- Time metrics
  avg_days_to_outcome DECIMAL(5,1),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(metric_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_date ON platform_metrics(metric_date DESC);

-- User-specific success metrics
CREATE TABLE IF NOT EXISTS user_contest_metrics (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),

  -- Overall stats
  total_contests INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,

  -- Financial
  total_fines_faced DECIMAL(12,2) DEFAULT 0,
  total_savings DECIMAL(12,2) DEFAULT 0,
  total_paid DECIMAL(12,2) DEFAULT 0,

  -- Streaks
  current_win_streak INTEGER DEFAULT 0,
  longest_win_streak INTEGER DEFAULT 0,

  -- By violation type
  stats_by_violation JSONB DEFAULT '{}',

  -- Badges/achievements
  badges JSONB DEFAULT '[]',

  last_contest_date DATE,
  last_win_date DATE,

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 9. RLS POLICIES
-- ============================================

-- Enable RLS on new tables
ALTER TABLE ward_contest_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE hearing_officer_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE signage_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE letter_quality_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE contest_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE tow_boot_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contest_metrics ENABLE ROW LEVEL SECURITY;

-- Public read for intelligence tables (anonymized data)
CREATE POLICY "Public read ward intelligence" ON ward_contest_intelligence FOR SELECT USING (true);
CREATE POLICY "Public read officer patterns" ON hearing_officer_patterns FOR SELECT USING (true);
CREATE POLICY "Public read learning stats" ON learning_stats FOR SELECT USING (true);
CREATE POLICY "Public read platform metrics" ON platform_metrics FOR SELECT USING (true);

-- Signage reports - users can read all, write own
CREATE POLICY "Public read signage" ON signage_reports FOR SELECT USING (true);
CREATE POLICY "Users insert own signage" ON signage_reports FOR INSERT WITH CHECK (auth.uid() = reported_by);
CREATE POLICY "Users update own signage" ON signage_reports FOR UPDATE USING (auth.uid() = reported_by);

-- Letter scores - users see own
CREATE POLICY "Users read own letter scores" ON letter_quality_scores FOR SELECT
  USING (EXISTS (SELECT 1 FROM contest_letters WHERE contest_letters.id = letter_quality_scores.letter_id AND contest_letters.user_id = auth.uid()));

-- Contest outcomes - users see own
CREATE POLICY "Users read own outcomes" ON contest_outcomes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own outcomes" ON contest_outcomes FOR INSERT WITH CHECK (user_id = auth.uid());

-- Tow alerts - users see own
CREATE POLICY "Users read own tow alerts" ON tow_boot_alerts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users update own tow alerts" ON tow_boot_alerts FOR UPDATE USING (user_id = auth.uid());

-- Evidence analysis - users see own
CREATE POLICY "Users read own evidence" ON evidence_analysis FOR SELECT USING (user_id = auth.uid());

-- User metrics - users see own
CREATE POLICY "Users read own metrics" ON user_contest_metrics FOR SELECT USING (user_id = auth.uid());

-- ============================================
-- 10. FUNCTIONS FOR UPDATING STATS
-- ============================================

-- Function to update learning stats after an outcome is recorded
CREATE OR REPLACE FUNCTION update_learning_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update violation stats
  INSERT INTO learning_stats (id, category, subcategory, total_cases, wins, losses, current_win_rate)
  VALUES (
    'violation:' || NEW.violation_type,
    'violation',
    NEW.violation_type,
    1,
    CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END,
    CASE WHEN NEW.outcome = 'upheld' THEN 1 ELSE 0 END,
    CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1.0 ELSE 0.0 END
  )
  ON CONFLICT (id) DO UPDATE SET
    total_cases = learning_stats.total_cases + 1,
    wins = learning_stats.wins + CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END,
    losses = learning_stats.losses + CASE WHEN NEW.outcome = 'upheld' THEN 1 ELSE 0 END,
    current_win_rate = (learning_stats.wins + CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END)::DECIMAL /
                       (learning_stats.total_cases + 1),
    last_updated = NOW();

  -- Update ward stats
  IF NEW.ward IS NOT NULL THEN
    INSERT INTO learning_stats (id, category, subcategory, total_cases, wins, losses, current_win_rate)
    VALUES (
      'ward:' || NEW.ward::TEXT,
      'ward',
      NEW.ward::TEXT,
      1,
      CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END,
      CASE WHEN NEW.outcome = 'upheld' THEN 1 ELSE 0 END,
      CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1.0 ELSE 0.0 END
    )
    ON CONFLICT (id) DO UPDATE SET
      total_cases = learning_stats.total_cases + 1,
      wins = learning_stats.wins + CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END,
      losses = learning_stats.losses + CASE WHEN NEW.outcome = 'upheld' THEN 1 ELSE 0 END,
      current_win_rate = (learning_stats.wins + CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END)::DECIMAL /
                         (learning_stats.total_cases + 1),
      last_updated = NOW();
  END IF;

  -- Update defense stats
  IF NEW.primary_defense IS NOT NULL THEN
    INSERT INTO learning_stats (id, category, subcategory, total_cases, wins, losses, current_win_rate)
    VALUES (
      'defense:' || NEW.primary_defense,
      'defense',
      NEW.primary_defense,
      1,
      CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END,
      CASE WHEN NEW.outcome = 'upheld' THEN 1 ELSE 0 END,
      CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1.0 ELSE 0.0 END
    )
    ON CONFLICT (id) DO UPDATE SET
      total_cases = learning_stats.total_cases + 1,
      wins = learning_stats.wins + CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END,
      losses = learning_stats.losses + CASE WHEN NEW.outcome = 'upheld' THEN 1 ELSE 0 END,
      current_win_rate = (learning_stats.wins + CASE WHEN NEW.outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END)::DECIMAL /
                         (learning_stats.total_cases + 1),
      last_updated = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update stats on new outcomes
DROP TRIGGER IF EXISTS trigger_update_learning_stats ON contest_outcomes;
CREATE TRIGGER trigger_update_learning_stats
  AFTER INSERT ON contest_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION update_learning_stats();

-- Function to update user metrics
CREATE OR REPLACE FUNCTION update_user_contest_metrics()
RETURNS TRIGGER AS $$
DECLARE
  is_win BOOLEAN;
BEGIN
  is_win := NEW.outcome IN ('dismissed', 'reduced');

  INSERT INTO user_contest_metrics (user_id, total_contests, total_wins, total_losses, win_rate, total_fines_faced, total_savings, last_contest_date, last_win_date)
  VALUES (
    NEW.user_id,
    1,
    CASE WHEN is_win THEN 1 ELSE 0 END,
    CASE WHEN NOT is_win THEN 1 ELSE 0 END,
    CASE WHEN is_win THEN 1.0 ELSE 0.0 END,
    COALESCE(NEW.original_amount, 0),
    COALESCE(NEW.amount_saved, 0),
    NEW.outcome_date,
    CASE WHEN is_win THEN NEW.outcome_date ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_contests = user_contest_metrics.total_contests + 1,
    total_wins = user_contest_metrics.total_wins + CASE WHEN is_win THEN 1 ELSE 0 END,
    total_losses = user_contest_metrics.total_losses + CASE WHEN NOT is_win THEN 1 ELSE 0 END,
    win_rate = (user_contest_metrics.total_wins + CASE WHEN is_win THEN 1 ELSE 0 END)::DECIMAL /
               (user_contest_metrics.total_contests + 1),
    total_fines_faced = user_contest_metrics.total_fines_faced + COALESCE(NEW.original_amount, 0),
    total_savings = user_contest_metrics.total_savings + COALESCE(NEW.amount_saved, 0),
    current_win_streak = CASE
      WHEN is_win THEN user_contest_metrics.current_win_streak + 1
      ELSE 0
    END,
    longest_win_streak = GREATEST(
      user_contest_metrics.longest_win_streak,
      CASE WHEN is_win THEN user_contest_metrics.current_win_streak + 1 ELSE user_contest_metrics.current_win_streak END
    ),
    last_contest_date = NEW.outcome_date,
    last_win_date = CASE WHEN is_win THEN NEW.outcome_date ELSE user_contest_metrics.last_win_date END,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user metrics
DROP TRIGGER IF EXISTS trigger_update_user_metrics ON contest_outcomes;
CREATE TRIGGER trigger_update_user_metrics
  AFTER INSERT ON contest_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION update_user_contest_metrics();

COMMENT ON TABLE ward_contest_intelligence IS 'Ward-specific contest statistics and patterns';
COMMENT ON TABLE hearing_officer_patterns IS 'Hearing officer tendencies and dismissal patterns';
COMMENT ON TABLE signage_reports IS 'Crowdsourced parking signage database';
COMMENT ON TABLE letter_quality_scores IS 'Quality scoring for generated contest letters';
COMMENT ON TABLE contest_outcomes IS 'Tracked outcomes for learning loop';
COMMENT ON TABLE learning_stats IS 'Aggregated learning statistics updated by triggers';
COMMENT ON TABLE tow_boot_alerts IS 'Tow and boot alerts for user vehicles';
COMMENT ON TABLE evidence_analysis IS 'OCR and analysis results for submitted evidence';
COMMENT ON TABLE platform_metrics IS 'Daily platform-wide metrics';
COMMENT ON TABLE user_contest_metrics IS 'Per-user contest statistics';
