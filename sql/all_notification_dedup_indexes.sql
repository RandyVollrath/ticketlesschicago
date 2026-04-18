-- Partial unique indexes on user_notifications for every notification type
-- that sends SMS/email/push. Each index makes duplicate sends structurally
-- impossible: pre-claim INSERT fails with 23505 and the cron skips.
--
-- Pattern: key on (user_id, notification_type, <event-specific field from metadata>)
-- so the SAME event can't trigger two notifications but DIFFERENT events
-- (or the same event for different users) go through normally.

-- Tow alerts — key on tow_id (each tow is one event).
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_tow_alert_dedup
ON public.user_notifications (user_id, notification_type, ((metadata->>'tow_id')))
WHERE notification_type = 'tow_alert' AND (metadata->>'tow_id') IS NOT NULL;

-- Relocation alerts — key on relocation_id.
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_relocation_alert_dedup
ON public.user_notifications (user_id, notification_type, ((metadata->>'relocation_id')))
WHERE notification_type = 'relocation_alert' AND (metadata->>'relocation_id') IS NOT NULL;

-- DOT permit alerts — key on message_key (which encodes the set of permit
-- application_numbers, so the same combination of permits can't double-send).
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_dot_permit_dedup
ON public.user_notifications (user_id, notification_type, ((metadata->>'message_key')))
WHERE notification_type = 'dot_permit' AND (metadata->>'message_key') IS NOT NULL;

-- Snow ban notifications — key on snow_event_id + metadata->>'type'
-- (different alert types for the same storm are OK).
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_snow_ban_dedup
ON public.user_notifications (user_id, notification_type, ((metadata->>'snow_event_id')), ((metadata->>'type')))
WHERE notification_type = 'snow_ban' AND (metadata->>'snow_event_id') IS NOT NULL;

-- Sticker / renewal reminders — key on expiry_type + days_before label so
-- 30-day, 7-day, 1-day reminders don't collide but same-window dupes do.
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_renewal_reminder_dedup
ON public.user_notifications (user_id, notification_type, ((metadata->>'expiry_type')), ((metadata->>'days_before')))
WHERE notification_type IN ('sticker_reminder', 'emissions_reminder') AND (metadata->>'expiry_type') IS NOT NULL;

-- notification_log table (separate from user_notifications) — used by
-- notify-sticker-purchased.ts, notify-emissions-test.ts, renewal cron. Pre-claim
-- via claimNotification() depends on this partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS notification_log_user_message_key_dedup
ON public.notification_log (user_id, message_key);
