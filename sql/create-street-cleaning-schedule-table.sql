-- Street Cleaning Schedule Table
-- Stores the street cleaning dates for Chicago wards and sections

CREATE TABLE IF NOT EXISTS street_cleaning_schedule (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ward TEXT NOT NULL,
  section TEXT NOT NULL,
  cleaning_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast lookups by ward/section/date
CREATE INDEX IF NOT EXISTS idx_ward_section_date
  ON street_cleaning_schedule(ward, section, cleaning_date);

-- Create index for upcoming cleanings
CREATE INDEX IF NOT EXISTS idx_cleaning_date
  ON street_cleaning_schedule(cleaning_date);

-- Optional: Add RLS policies if needed
-- ALTER TABLE street_cleaning_schedule ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow public read access" ON street_cleaning_schedule FOR SELECT USING (true);

-- Comment on table
COMMENT ON TABLE street_cleaning_schedule IS 'Chicago street cleaning schedule by ward and section';