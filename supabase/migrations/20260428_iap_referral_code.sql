-- Track Rewardful affiliate token (the ?via= code) on Apple IAP transactions.
-- Apple/Google in-app purchases never touch Stripe, so Rewardful's automatic
-- attribution via client_reference_id can't see them. We capture the affiliate
-- code in the iOS paywall, persist it here, and mirror to affiliate_commission_tracker
-- so the existing manual-commission-adjustment workflow handles IAP sales too.
ALTER TABLE iap_transactions
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE INDEX IF NOT EXISTS idx_iap_transactions_referral_code
  ON iap_transactions(referral_code)
  WHERE referral_code IS NOT NULL;
