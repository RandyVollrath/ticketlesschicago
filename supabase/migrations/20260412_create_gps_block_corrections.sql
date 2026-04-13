-- =====================================================
-- GPS BLOCK CORRECTIONS — Per-block learned GPS offset corrections
-- =====================================================
-- Stores the average GPS offset for each city block, learned from:
--   1. Metered parking locations (surveyed ground truth)
--   2. User feedback (confirmed correct/incorrect locations)
--   3. Parking history vs snap-to-street results
--
-- Applied at check-parking time to correct raw GPS before snap-to-street.
-- The model improves over time as more parking events provide ground truth.

CREATE TABLE IF NOT EXISTS gps_block_corrections (
  id BIGSERIAL PRIMARY KEY,
  -- Block identifier (100-block level, matching Chicago grid)
  street_direction TEXT NOT NULL,       -- N, S, E, W
  street_name TEXT NOT NULL,            -- ROCKWELL, LAWRENCE, etc.
  block_number INTEGER NOT NULL,        -- 4700, 2000, etc.

  -- Learned correction (average offset to add to raw GPS)
  offset_lat DOUBLE PRECISION DEFAULT 0,  -- degrees to add to raw latitude
  offset_lng DOUBLE PRECISION DEFAULT 0,  -- degrees to add to raw longitude

  -- Confidence tracking
  sample_count INTEGER DEFAULT 0,       -- number of parking events contributing
  last_updated TIMESTAMPTZ DEFAULT NOW(),

  -- Side-of-street learning
  east_count INTEGER DEFAULT 0,         -- events where user was on east side
  west_count INTEGER DEFAULT 0,
  north_count INTEGER DEFAULT 0,
  south_count INTEGER DEFAULT 0,

  UNIQUE (street_direction, street_name, block_number)
);

-- Spatial lookup by block
CREATE INDEX IF NOT EXISTS idx_gps_corrections_block
  ON gps_block_corrections (street_direction, street_name, block_number);

-- No RLS needed — read by server, written by server
ALTER TABLE gps_block_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on corrections"
  ON gps_block_corrections FOR ALL
  USING (true) WITH CHECK (true);
