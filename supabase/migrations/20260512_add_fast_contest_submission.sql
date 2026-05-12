-- Per-user toggle for how aggressively we auto-mail the contest letter.
--
-- TRUE (default): Auto-mail 3 calendar days after we DETECT the ticket
--   (capped at Chicago's 21-day mail-contest hard deadline). Gives the user
--   a 3-day evidence window then files fast — most contest-by-mail wins come
--   from being on file, not from late-arriving evidence.
--
-- FALSE: User opts to stretch evidence collection. We fall back to the prior
--   Day-17-from-issue auto-send floor; if the user keeps the letter held past
--   Day 21 they're knowingly filing late and accepting the late-submission
--   penalty.
--
-- Toggle lives in pages/settings.tsx; logic lives in lib/contest-deadlines.ts.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS fast_contest_submission BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN user_profiles.fast_contest_submission IS
  'TRUE = auto-mail contest letter 3 days after detection. FALSE = wait, even past 21 days (incurs late filing penalty). Default TRUE.';
