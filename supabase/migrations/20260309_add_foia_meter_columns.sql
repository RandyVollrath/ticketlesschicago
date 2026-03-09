-- Add columns for FOIA F126827-020326 meter inventory data
-- Source: City of Chicago Dept. of Finance, March 9, 2026

ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS side_of_street TEXT;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS rate_zone INTEGER;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS rush_hour_schedule TEXT;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS sunday_schedule TEXT;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS is_seasonal BOOLEAN DEFAULT FALSE;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS is_lot BOOLEAN DEFAULT FALSE;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS foia_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS foia_updated_at TIMESTAMPTZ;
ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS pay_box_address INTEGER;

-- Comment on source
COMMENT ON COLUMN metered_parking_locations.side_of_street IS 'Official side of street from FOIA (N/S/E/W)';
COMMENT ON COLUMN metered_parking_locations.rate_zone IS 'Official rate zone 1-5 ($0.50-$14.00/hr)';
COMMENT ON COLUMN metered_parking_locations.rush_hour_schedule IS 'Rush hour windows e.g. "RH1: Mon-Fri 7 AM-9 AM; RH2: Mon-Fri 4 PM-6 PM"';
COMMENT ON COLUMN metered_parking_locations.sunday_schedule IS 'Sunday-specific schedule if different from weekday';
COMMENT ON COLUMN metered_parking_locations.is_seasonal IS 'Meter only active Memorial Day through Labor Day';
COMMENT ON COLUMN metered_parking_locations.is_lot IS 'Meter is in a parking lot (not street)';
COMMENT ON COLUMN metered_parking_locations.foia_verified IS 'Data verified against official FOIA response';
COMMENT ON COLUMN metered_parking_locations.foia_updated_at IS 'When FOIA data was last imported';
