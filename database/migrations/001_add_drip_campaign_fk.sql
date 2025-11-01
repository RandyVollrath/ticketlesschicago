-- Migration: Add foreign key relationship for drip_campaign_status
-- Date: 2025-10-26
-- Purpose: Allow drip email queries to join with user_profiles table

-- Drop constraint if it exists (idempotent)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'drip_campaign_status_user_id_fkey'
        AND table_name = 'drip_campaign_status'
    ) THEN
        ALTER TABLE drip_campaign_status DROP CONSTRAINT drip_campaign_status_user_id_fkey;
    END IF;
END $$;

-- Add foreign key relationship
ALTER TABLE drip_campaign_status
ADD CONSTRAINT drip_campaign_status_user_id_fkey
FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
ON DELETE CASCADE;

-- Create index for faster joins
CREATE INDEX IF NOT EXISTS drip_campaign_status_user_id_idx
ON drip_campaign_status(user_id);

-- Verify the relationship was created
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'drip_campaign_status';
