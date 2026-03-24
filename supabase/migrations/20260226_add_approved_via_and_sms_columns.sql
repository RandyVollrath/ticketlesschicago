-- Add approved_via column to contest_letters for tracking how a letter was approved
-- (admin_review, auto_deadline_safety_net, user_approval, etc.)
ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS approved_via TEXT;

-- Add sms_reminder_sent_at to detected_tickets for tracking SMS notification timing
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS sms_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS sms_last_chance_sent_at TIMESTAMPTZ;
