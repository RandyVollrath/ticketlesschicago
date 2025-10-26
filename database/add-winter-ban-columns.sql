-- Add winter ban street tracking columns to user_profiles
-- This allows us to show users if their street cleaning address is on a winter overnight parking ban street

ALTER TABLE public.user_profiles
  -- Track if user's address is on a winter overnight parking ban street
  ADD COLUMN IF NOT EXISTS on_winter_ban_street BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS winter_ban_street VARCHAR(255);

-- Add comments for documentation
COMMENT ON COLUMN public.user_profiles.on_winter_ban_street IS
  'Whether the user''s street cleaning address (home_address_full) is on a Chicago winter overnight parking ban street (3am-7am, Dec 1 - Apr 1)';

COMMENT ON COLUMN public.user_profiles.winter_ban_street IS
  'The street name if the user is on a winter ban street (e.g., "LAKE SHORE DR")';
