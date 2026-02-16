-- Mobile ground-truth feedback and reliability telemetry
-- Used to tune parking/camera detection with real user outcomes.

create table if not exists public.mobile_ground_truth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_ts timestamptz not null,
  drive_session_id text null,
  latitude double precision null,
  longitude double precision null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_mobile_ground_truth_events_user_ts
  on public.mobile_ground_truth_events(user_id, event_ts desc);

create index if not exists idx_mobile_ground_truth_events_type_ts
  on public.mobile_ground_truth_events(event_type, event_ts desc);

create index if not exists idx_mobile_ground_truth_events_drive_session
  on public.mobile_ground_truth_events(drive_session_id)
  where drive_session_id is not null;

alter table public.mobile_ground_truth_events enable row level security;

-- Users can read their own feedback rows.
create policy if not exists "ground_truth_select_own"
  on public.mobile_ground_truth_events
  for select
  using (auth.uid() = user_id);

-- Inserts are service-role mediated via API route (recommended).
-- No direct client insert policy is intentionally added.
