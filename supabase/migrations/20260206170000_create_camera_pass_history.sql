-- Camera pass history captured by mobile app while driving past camera locations.
-- Stores measured user speed at pass time and expected speed when available.

create table if not exists public.camera_pass_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  passed_at timestamptz not null default now(),
  camera_type text not null check (camera_type in ('speed', 'redlight')),
  camera_address text not null,
  camera_latitude double precision not null,
  camera_longitude double precision not null,
  user_latitude double precision not null,
  user_longitude double precision not null,
  user_speed_mps double precision,
  user_speed_mph double precision,
  expected_speed_mph double precision,
  speed_delta_mph double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_camera_pass_history_user_passed_at
  on public.camera_pass_history (user_id, passed_at desc);

create index if not exists idx_camera_pass_history_passed_at
  on public.camera_pass_history (passed_at desc);

alter table public.camera_pass_history enable row level security;

create policy "Users can insert own camera pass history"
  on public.camera_pass_history
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can view own camera pass history"
  on public.camera_pass_history
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can delete own camera pass history"
  on public.camera_pass_history
  for delete
  to authenticated
  using (auth.uid() = user_id);
