CREATE TABLE IF NOT EXISTS zone_geometry_edits (
  id SERIAL PRIMARY KEY,
  ward_section TEXT UNIQUE NOT NULL,
  ward TEXT,
  section TEXT,
  geometry JSONB,
  confirmed BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE zone_geometry_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON zone_geometry_edits FOR ALL USING (true) WITH CHECK (true);
