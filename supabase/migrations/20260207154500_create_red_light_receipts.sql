-- Red-light camera pass receipts captured by mobile trace windows.
-- Used for timeline summaries and ticket-time matching.

create table if not exists public.red_light_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_timestamp timestamptz not null,
  server_received_at timestamptz not null default now(),
  camera_address text not null,
  camera_latitude double precision not null,
  camera_longitude double precision not null,
  intersection_id text not null,
  heading double precision,
  approach_speed_mph double precision,
  min_speed_mph double precision,
  speed_delta_mph double precision,
  full_stop_detected boolean not null default false,
  full_stop_duration_sec double precision,
  horizontal_accuracy_meters double precision,
  estimated_speed_accuracy_mph double precision,
  trace jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_red_light_receipts_user_device_ts
  on public.red_light_receipts (user_id, device_timestamp desc);

create index if not exists idx_red_light_receipts_intersection_device_ts
  on public.red_light_receipts (intersection_id, device_timestamp desc);

alter table public.red_light_receipts enable row level security;

create policy "Users can insert own red light receipts"
  on public.red_light_receipts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can view own red light receipts"
  on public.red_light_receipts
  for select
  to authenticated
  using (auth.uid() = user_id);
