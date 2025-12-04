-- Add sticker reminder tracking columns to renewal_orders
ALTER TABLE renewal_orders ADD COLUMN IF NOT EXISTS sticker_reminder_date DATE;
ALTER TABLE renewal_orders ADD COLUMN IF NOT EXISTS sticker_reminder_count INTEGER DEFAULT 0;
ALTER TABLE renewal_orders ADD COLUMN IF NOT EXISTS sticker_applied BOOLEAN DEFAULT false;
ALTER TABLE renewal_orders ADD COLUMN IF NOT EXISTS sticker_applied_at TIMESTAMPTZ;
ALTER TABLE renewal_orders ADD COLUMN IF NOT EXISTS needs_manual_followup BOOLEAN DEFAULT false;

-- Index for the cron job to find orders needing reminders
CREATE INDEX IF NOT EXISTS idx_renewal_orders_sticker_reminder
ON renewal_orders (sticker_reminder_date, sticker_applied, needs_manual_followup)
WHERE sticker_reminder_date IS NOT NULL AND sticker_applied = false AND needs_manual_followup = false;
