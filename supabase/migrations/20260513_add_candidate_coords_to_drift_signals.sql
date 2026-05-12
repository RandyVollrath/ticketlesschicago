-- Persist the representative lat/lng of the candidate (most-frequent) overnight
-- section so the admin digest and admin review UI can reverse-geocode it to a
-- street and link to Google Maps without re-querying parking history.
alter table public.home_address_drift_signals
  add column if not exists candidate_lat double precision,
  add column if not exists candidate_lng double precision;
