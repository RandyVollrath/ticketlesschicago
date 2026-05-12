-- GPS Home Address Drift Detection
--
-- Internal/admin-only signal table. Records the daily comparison between a
-- user's stated home_address_section/ward and where their phone has been
-- parking overnight. Not surfaced to users; consumed by ops review and future
-- admin tooling. See lib/home-address-drift.ts for the algorithm.

create table if not exists public.home_address_drift_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  detected_at timestamptz not null default now(),
  status text not null check (status in (
    'INSUFFICIENT_DATA','STILL_AT_HOME','CONFIRMED_HOME',
    'DRIFT_DETECTED','AMBIGUOUS'
  )),
  home_ward text,
  home_section text,
  candidate_ward text,
  candidate_section text,
  candidate_fraction numeric(4,3),
  home_fraction numeric(4,3),
  overnight_event_count int,
  window_days int not null default 14,
  user_response text check (user_response in ('moved','visiting','manual_update','dismissed')),
  responded_at timestamptz,
  cooldown_until timestamptz
);

create index if not exists home_address_drift_signals_user_detected_idx
  on public.home_address_drift_signals (user_id, detected_at desc);

create index if not exists home_address_drift_signals_unresolved_drift_idx
  on public.home_address_drift_signals (status)
  where status = 'DRIFT_DETECTED' and user_response is null;
