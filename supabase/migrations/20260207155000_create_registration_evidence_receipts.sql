-- Stores forwarded registration purchase evidence emails for contest support.
-- Supports city sticker receipts (SEBIS) and license plate sticker receipts (ILSOS).

create table if not exists public.registration_evidence_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('city_sticker', 'license_plate')),
  sender_email text not null,
  email_subject text,
  email_text text,
  email_html text,
  storage_bucket text,
  storage_path text,
  screenshot_path text,
  file_name text,
  forwarded_at timestamptz not null default now(),
  parsed_purchase_date date,
  parsed_order_id text,
  parsed_amount_cents integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_registration_evidence_user_forwarded
  on public.registration_evidence_receipts (user_id, forwarded_at desc);

create index if not exists idx_registration_evidence_user_source
  on public.registration_evidence_receipts (user_id, source_type, forwarded_at desc);

alter table public.registration_evidence_receipts enable row level security;

create policy "Users can view own registration evidence receipts"
  on public.registration_evidence_receipts
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own registration evidence receipts"
  on public.registration_evidence_receipts
  for insert
  to authenticated
  with check (auth.uid() = user_id);
