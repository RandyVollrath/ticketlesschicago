-- Drop the FK constraint on user_notifications.user_id.
--
-- The FK targets the legacy public.users table. The signup flow creates rows
-- in auth.users + public.user_profiles, but NOT in public.users — so 169 of
-- 181 profiles had no matching users row. Inserts into user_notifications
-- failed with a 23503 FK violation. logNotification swallowed the error in
-- try/catch, dedup never found the row, and the cron re-sent every fire.
-- That's why Travis Bee got 4 follow-up SMS on 2026-04-17.
--
-- user_notifications is an append-only log. Orphan rows after a user is
-- deleted are fine (they're history). Dropping the FK kills the class of
-- silent-insert-fail bug without needing to keep the users table in sync.
--
-- Added as a belt-and-suspenders layer beneath the app-level pre-claim fix
-- in pages/api/street-cleaning/process.ts. Even if a future code path forgets
-- to pre-claim, inserts will now succeed and dedup will work.

ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_user_id_fkey;

-- Verify: this should return zero rows after the migration runs.
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'public.user_notifications'::regclass
--   AND contype = 'f'
--   AND conname = 'user_notifications_user_id_fkey';
