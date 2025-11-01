-- Show exactly WHO is pending each email type

-- Users pending PROOF email (Day 3)
SELECT
  'PENDING PROOF EMAIL (Day 3)' as email_type,
  d.email,
  d.user_id,
  d.welcome_sent_at,
  EXTRACT(DAY FROM (NOW() - d.welcome_sent_at)) as days_since_welcome,
  d.proof_sent,
  d.unsubscribed
FROM drip_campaign_status d
WHERE d.welcome_sent = true
  AND d.proof_sent = false
  AND d.unsubscribed = false
ORDER BY d.welcome_sent_at ASC;

-- Users pending WELCOME email (Day 0)
SELECT
  'PENDING WELCOME EMAIL (Day 0)' as email_type,
  d.email,
  d.user_id,
  d.created_at,
  d.welcome_sent,
  d.unsubscribed
FROM drip_campaign_status d
WHERE d.welcome_sent = false
  AND d.unsubscribed = false
ORDER BY d.created_at DESC;

-- Users pending SOFT SELL email (Day 7)
SELECT
  'PENDING SOFT SELL EMAIL (Day 7)' as email_type,
  d.email,
  d.user_id,
  d.proof_sent_at,
  EXTRACT(DAY FROM (NOW() - d.proof_sent_at)) as days_since_proof,
  d.soft_sell_sent,
  d.unsubscribed
FROM drip_campaign_status d
WHERE d.proof_sent = true
  AND d.soft_sell_sent = false
  AND d.unsubscribed = false
ORDER BY d.proof_sent_at ASC;
