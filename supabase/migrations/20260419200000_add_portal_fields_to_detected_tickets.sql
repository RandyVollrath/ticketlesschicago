-- Phase 1 of the CHI PAY scraper upgrade: persist every field the portal
-- search API actually exposes. The violation address, officer badge, photo
-- URL and violation code are NOT available from the public payment portal
-- (everything there is tagged "Ticket -- Skeletal"), so those are populated
-- later via the user-photo OCR path. This migration adds the columns that
-- ARE available but were being thrown away.
--
-- All columns nullable so legacy rows keep working.

ALTER TABLE detected_tickets
  -- "tk:<ticket_number>" — stable receivable id for future portal detail
  -- endpoint probes and cross-reference with FOIA responses.
  ADD COLUMN IF NOT EXISTS portal_receivable_id TEXT,

  -- Portal's classification code, e.g. "CANVAS_PARKING_TICKET_SKELETAL",
  -- "CANVAS_RED_LIGHT", "CANVAS_AUTOMATED_SPEED". More granular than the
  -- parking/red_light/speed inference we do off the description text.
  ADD COLUMN IF NOT EXISTS portal_receivable_type TEXT,

  -- Human-readable classification, e.g. "Ticket -- Skeletal". Tracked as a
  -- sentinel: if this ever flips to a non-"Skeletal" value the portal may
  -- have started exposing fuller records and the scraper can be upgraded.
  ADD COLUMN IF NOT EXISTS portal_receivable_description TEXT,

  -- Whether the portal considers the ticket currently payable. Tickets in
  -- collections come back payable=false and need a different contest
  -- strategy than active Notice-level tickets.
  ADD COLUMN IF NOT EXISTS portal_payable BOOLEAN,

  -- Hearing window — when present, gives a hard deadline to work against.
  -- Stored as TEXT (rather than TIMESTAMPTZ) because the portal returns
  -- empty strings for tickets outside the hearing queue and we want to
  -- preserve the raw portal value without ambiguity.
  ADD COLUMN IF NOT EXISTS hearing_start_date TEXT,
  ADD COLUMN IF NOT EXISTS hearing_end_date TEXT;

CREATE INDEX IF NOT EXISTS idx_detected_tickets_portal_receivable_id
  ON detected_tickets(portal_receivable_id)
  WHERE portal_receivable_id IS NOT NULL;

COMMENT ON COLUMN detected_tickets.portal_receivable_id
  IS 'CHI PAY receivable id, format tk:<ticket_number>. Stable across sessions.';
COMMENT ON COLUMN detected_tickets.portal_receivable_description
  IS 'Portal classification like "Ticket -- Skeletal". Watch for drift — if it ever flips to a non-Skeletal value the portal may have started exposing the full ticket.';
