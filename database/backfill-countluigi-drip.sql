-- Backfill drip campaign records for ALL users who don't have them
-- This adds all users to the welcome email drip campaign

INSERT INTO drip_campaign_status (user_id, email, campaign_name, welcome_sent, proof_sent, soft_sell_sent, unsubscribed, created_at)
SELECT
  user_id,
  email,
  'free_alerts_onboarding' as campaign_name,
  false as welcome_sent,
  false as proof_sent,
  false as soft_sell_sent,
  false as unsubscribed,
  NOW() as created_at
FROM user_profiles
WHERE email IS NOT NULL
  AND user_id NOT IN (SELECT user_id FROM drip_campaign_status WHERE user_id IS NOT NULL)
ON CONFLICT (user_id) DO NOTHING;

-- Show how many were added
SELECT COUNT(*) as users_added
FROM drip_campaign_status
WHERE created_at > (NOW() - INTERVAL '1 minute');
