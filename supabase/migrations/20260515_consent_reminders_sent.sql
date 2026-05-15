-- Track which pre-charge reminder milestones we've emailed for each granted
-- consent. With the new default-compliant model, a single consent row may get
-- emails at 30, 14, and 3 days before its expected charge date — this column
-- prevents the daily cron from spamming the same milestone twice.

ALTER TABLE renewal_purchase_consents
  ADD COLUMN IF NOT EXISTS reminders_sent INTEGER[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN renewal_purchase_consents.reminders_sent IS
  'Array of milestone day-counts (30, 14, 3) for which we have already emailed a pre-charge reminder. Used by create-authorized-renewal-consents to dedupe.';

-- Also tag rows that were auto-granted (no per-renewal user click) vs the
-- old explicit-Authorize flow, so we can tell the two apart in audit logs
-- and in support tooling.
ALTER TABLE renewal_purchase_consents
  ADD COLUMN IF NOT EXISTS auto_granted BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN renewal_purchase_consents.auto_granted IS
  'TRUE when the consent was auto-granted because the user had auto-renewal toggled on in /settings (default-compliant flow). FALSE for legacy per-renewal Authorize-click consents.';
