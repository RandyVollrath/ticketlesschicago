-- Check which users are in drip campaign and their email status
-- This shows who SHOULD have gotten emails

-- Users who should get welcome emails (haven't received it yet)
SELECT
  'PENDING WELCOME EMAIL' as status,
  d.email,
  d.created_at as added_to_campaign,
  d.welcome_sent,
  d.welcome_sent_at,
  d.unsubscribed
FROM drip_campaign_status d
WHERE d.welcome_sent = false
  AND d.unsubscribed = false
ORDER BY d.created_at DESC;

-- Users who already got welcome email
SELECT
  'WELCOME SENT' as status,
  d.email,
  d.welcome_sent_at,
  d.proof_sent,
  d.proof_sent_at,
  d.soft_sell_sent,
  d.soft_sell_sent_at
FROM drip_campaign_status d
WHERE d.welcome_sent = true
ORDER BY d.welcome_sent_at DESC
LIMIT 10;

-- Summary counts
SELECT
  COUNT(*) FILTER (WHERE welcome_sent = false AND unsubscribed = false) as pending_welcome,
  COUNT(*) FILTER (WHERE welcome_sent = true AND proof_sent = false AND unsubscribed = false) as pending_proof,
  COUNT(*) FILTER (WHERE proof_sent = true AND soft_sell_sent = false AND unsubscribed = false) as pending_soft_sell,
  COUNT(*) FILTER (WHERE soft_sell_sent = true) as completed_campaign,
  COUNT(*) FILTER (WHERE unsubscribed = true) as unsubscribed
FROM drip_campaign_status;
