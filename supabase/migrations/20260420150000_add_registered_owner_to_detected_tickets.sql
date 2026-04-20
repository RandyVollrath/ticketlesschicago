-- Phase 3 of the CHI PAY scraper upgrade: persist the registered-owner
-- contact info that comes back in searchResult.contactInformation.
--
-- This is the address the City of Chicago has on file for the license
-- plate from the vehicle-registration record. It is NOT the violation
-- address (that's not available anywhere in the public payment portal —
-- the OCR path on user ticket photos fills that in). What this DOES give
-- us:
--   1. Detect mismatch vs user_profiles.mailing_address → stale registration
--      or improper-service defense.
--   2. Confirm the plate's registered owner matches the person signing
--      the contest letter (prevents accidentally contesting someone else's
--      ticket on a shared plate).
--   3. Let the admin dashboard surface when a customer needs to update
--      their state registration address.

ALTER TABLE detected_tickets
  ADD COLUMN IF NOT EXISTS registered_owner_name TEXT,
  ADD COLUMN IF NOT EXISTS registered_owner_address TEXT;

COMMENT ON COLUMN detected_tickets.registered_owner_name
  IS 'Contact name from searchResult.contactInformation (city vehicle registration). Not necessarily the user of the service.';
COMMENT ON COLUMN detected_tickets.registered_owner_address
  IS 'Single-line registered-owner mailing address from the city. NOT the violation address.';
