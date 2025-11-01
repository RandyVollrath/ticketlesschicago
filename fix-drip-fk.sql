-- Add foreign key relationship between drip_campaign_status and user_profiles
-- This allows queries like: .select('*, user_profiles!inner(first_name)')

ALTER TABLE drip_campaign_status
ADD CONSTRAINT drip_campaign_status_user_id_fkey
FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
ON DELETE CASCADE;

-- Create index for faster joins
CREATE INDEX IF NOT EXISTS drip_campaign_status_user_id_idx
ON drip_campaign_status(user_id);
