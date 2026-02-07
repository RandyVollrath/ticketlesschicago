-- Stores forwarded city sticker purchase receipts for contest evidence.

create table if not exists public.city_sticker_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_email text not null,
  email_subject text,
  storage_path text not null,
  file_name text,
  forwarded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_city_sticker_receipts_user_forwarded_at
  on public.city_sticker_receipts (user_id, forwarded_at desc);

alter table public.city_sticker_receipts enable row level security;

create policy "Users can view own city sticker receipts"
  on public.city_sticker_receipts
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own city sticker receipts"
  on public.city_sticker_receipts
  for insert
  to authenticated
  with check (auth.uid() = user_id);
