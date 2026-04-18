-- Belt-and-suspenders final: make duplicate street_cleaning SMS structurally
-- impossible at the DB level. Prior defenses (pre-claim + hour-pin) rely on
-- the application doing the right thing. This unique index means Postgres
-- itself rejects any INSERT that would produce a second SMS for the same
-- (user, cleaning_date, alert type) on the same Chicago day.
--
-- Scope limited by the partial WHERE clause so multi-day reminders (day-of,
-- 1-day-before, 3-days-before) for the same cleaning_date still work — each
-- lands on a different Chicago calendar day and so has a different index
-- key. The only thing this blocks is two SMS for the same user / cleaning_date
-- / alert type on the same calendar day in Chicago — exactly the bug.

CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_unique_daily_send
ON public.user_notifications (
  user_id,
  notification_type,
  cleaning_date,
  ((metadata->>'type')),
  ((sent_at AT TIME ZONE 'America/Chicago')::date)
)
WHERE notification_type = 'street_cleaning' AND cleaning_date IS NOT NULL;
