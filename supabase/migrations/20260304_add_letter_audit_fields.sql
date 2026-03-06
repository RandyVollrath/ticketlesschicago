-- Add letter audit and evidence tracking fields to ticket_contests
ALTER TABLE ticket_contests
  ADD COLUMN IF NOT EXISTS letter_audit JSONB,          -- Self-audit results from adversarial review
  ADD COLUMN IF NOT EXISTS evidence_gaps JSONB,         -- Evidence gap analysis (what's missing vs available)
  ADD COLUMN IF NOT EXISTS letter_quality_score INTEGER, -- Overall quality score 0-100
  ADD COLUMN IF NOT EXISTS evidence_sources TEXT[],     -- All evidence sources used in generation
  ADD COLUMN IF NOT EXISTS kit_metadata JSONB;          -- Contest kit/argument tracking for outcome learning

-- Contest learnings table — stores insights from outcome analysis
-- Used to improve future letter generation by injecting proven patterns
CREATE TABLE IF NOT EXISTS contest_learnings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  violation_code TEXT NOT NULL,
  learning_type TEXT NOT NULL CHECK (learning_type IN (
    'pattern',                  -- General pattern from win/loss analysis
    'evidence_impact',          -- Which evidence types correlate with wins
    'argument_effectiveness',   -- Which arguments work best
    'common_mistake'            -- Patterns found in losing letters
  )),
  learning TEXT NOT NULL,       -- The insight/recommendation
  sample_size INTEGER NOT NULL, -- How many cases this is based on
  win_rate_impact DECIMAL(5,2), -- Estimated impact on win rate (can be null for qualitative learnings)
  source_outcomes UUID[],       -- IDs of contest_outcomes used to derive this learning
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '90 days'), -- Learnings expire
  is_active BOOLEAN DEFAULT true
);

-- Index for looking up active learnings by violation code
CREATE INDEX IF NOT EXISTS idx_contest_learnings_active
  ON contest_learnings (violation_code, is_active)
  WHERE is_active = true;

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_contest_learnings_expires
  ON contest_learnings (expires_at)
  WHERE is_active = true;

-- RLS policies
ALTER TABLE contest_learnings ENABLE ROW LEVEL SECURITY;

-- Learnings are readable by all authenticated users (they're aggregate insights, not personal data)
CREATE POLICY "Authenticated users can read learnings"
  ON contest_learnings FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can insert/update/delete (via cron job)
CREATE POLICY "Service role manages learnings"
  ON contest_learnings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON contest_learnings TO authenticated;
GRANT ALL ON contest_learnings TO service_role;
