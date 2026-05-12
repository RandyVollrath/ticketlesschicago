-- Encrypted IL Secretary of State renewal credentials per user.
-- Reg ID + PIN together let anyone renew the plate online, so PIN is stored
-- encrypted (AES-256-GCM, app-side via lib/credentials-vault.ts).
-- Reg ID alone is on the registration card the user shows at parking garages,
-- but we encrypt it too to keep the pair under one access policy.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS il_registration_id_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS il_pin_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS il_credentials_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS il_credentials_invalid_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.il_registration_id_encrypted IS
  'IL SOS Registration ID, AES-256-GCM ciphertext (iv.tag.ct base64). Decrypt server-side only.';
COMMENT ON COLUMN user_profiles.il_pin_encrypted IS
  'IL SOS PIN, AES-256-GCM ciphertext. Stable until plate is re-issued (lost/stolen/10-yr program).';
COMMENT ON COLUMN user_profiles.il_credentials_updated_at IS
  'When the user last entered or updated IL credentials.';
COMMENT ON COLUMN user_profiles.il_credentials_invalid_at IS
  'Set when an automation run got rejected by IL SOS as invalid PIN/RegID. Pause renewals until re-entered.';
