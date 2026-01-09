-- Add status column to property_tax_deadlines table
-- Status tracks whether deadlines are known, confirmed, or expired

-- Add status column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'property_tax_deadlines' AND column_name = 'status'
  ) THEN
    ALTER TABLE property_tax_deadlines
    ADD COLUMN status TEXT DEFAULT 'unknown';
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN property_tax_deadlines.status IS 'Deadline status: unknown, confirmed, or expired';

-- Update existing records without status to unknown
UPDATE property_tax_deadlines
SET status = 'unknown'
WHERE status IS NULL;
