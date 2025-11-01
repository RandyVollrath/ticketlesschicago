-- Check who has marketing consent in user_profiles
SELECT
  'USERS WITH MARKETING CONSENT' as group_name,
  COUNT(*) as total_count
FROM user_profiles
WHERE marketing_consent = true;

-- Show all users with marketing consent
SELECT
  up.email,
  up.first_name,
  up.marketing_consent,
  up.created_at as profile_created,
  d.welcome_sent,
  d.welcome_sent_at,
  d.proof_sent,
  d.soft_sell_sent,
  CASE
    WHEN d.user_id IS NULL THEN 'NOT IN DRIP CAMPAIGN'
    WHEN d.welcome_sent = false THEN 'PENDING WELCOME'
    WHEN d.proof_sent = false THEN 'PENDING PROOF'
    WHEN d.soft_sell_sent = false THEN 'PENDING SOFT SELL'
    ELSE 'CAMPAIGN COMPLETE'
  END as drip_status
FROM user_profiles up
LEFT JOIN drip_campaign_status d ON up.user_id = d.user_id
WHERE up.marketing_consent = true
ORDER BY up.created_at DESC;

-- Check for users NOT in drip campaign who should be
SELECT
  'MISSING FROM DRIP CAMPAIGN' as issue,
  up.email,
  up.first_name,
  up.marketing_consent,
  up.created_at
FROM user_profiles up
WHERE up.marketing_consent = true
  AND up.user_id NOT IN (SELECT user_id FROM drip_campaign_status WHERE user_id IS NOT NULL)
ORDER BY up.created_at DESC;
