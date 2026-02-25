-- FOIA History Requests: track plate-level "how many tickets have I gotten?" FOIA requests
-- Separate from ticket_foia_requests (which is for contesting evidence on individual tickets)

create table if not exists public.foia_history_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,                          -- null for anonymous public lookups (before account creation)
  email text not null,
  name text not null,
  license_plate text not null,
  license_state text not null default 'IL',
  consent_given boolean not null default false,
  consent_given_at timestamptz null,
  consent_ip text null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'fulfilled', 'failed', 'cancelled')),
  foia_sent_at timestamptz null,
  foia_email_id text null,                    -- Resend email ID for the FOIA request
  response_received_at timestamptz null,
  response_data jsonb null,                   -- parsed ticket history when city responds
  ticket_count integer null,                  -- total tickets found (filled on fulfillment)
  total_fines numeric null,                   -- total fines (filled on fulfillment)
  source text not null default 'public_lookup'
    check (source in ('public_lookup', 'signup_auto', 'dashboard')),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_foia_history_requests_email on public.foia_history_requests(email);
create index if not exists idx_foia_history_requests_plate on public.foia_history_requests(license_plate);
create index if not exists idx_foia_history_requests_status on public.foia_history_requests(status);
create index if not exists idx_foia_history_requests_user_id on public.foia_history_requests(user_id);
create index if not exists idx_foia_history_requests_created_at on public.foia_history_requests(created_at desc);

-- RLS
alter table public.foia_history_requests enable row level security;

-- Users can view their own FOIA history requests
drop policy if exists "Users can view their own FOIA history requests" on public.foia_history_requests;
create policy "Users can view their own FOIA history requests"
  on public.foia_history_requests
  for select
  using (auth.uid() = user_id);

-- Allow inserts from API (service role handles public submissions)
-- No user-level insert policy needed since public submissions go through the API with service role

-- Add foia_history_consent fields to user_profiles
alter table public.user_profiles
  add column if not exists foia_history_consent boolean default false,
  add column if not exists foia_history_consent_at timestamptz null;
