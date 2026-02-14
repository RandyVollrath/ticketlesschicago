-- Queue FOIA requests tied to contested tickets so outcome/evidence can be tracked.

create table if not exists public.ticket_foia_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.detected_tickets(id) on delete cascade,
  contest_letter_id uuid null references public.contest_letters(id) on delete set null,
  user_id uuid not null,
  request_type text not null default 'ticket_evidence_packet',
  status text not null default 'queued' check (status in ('queued', 'drafting', 'sent', 'fulfilled', 'failed', 'not_needed')),
  source text not null default 'autopilot_mailing',
  notes text null,
  request_payload jsonb null,
  response_payload jsonb null,
  requested_at timestamptz not null default now(),
  sent_at timestamptz null,
  fulfilled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, request_type)
);

create index if not exists idx_ticket_foia_requests_user_id on public.ticket_foia_requests(user_id);
create index if not exists idx_ticket_foia_requests_status on public.ticket_foia_requests(status);
create index if not exists idx_ticket_foia_requests_requested_at on public.ticket_foia_requests(requested_at desc);

alter table public.ticket_foia_requests enable row level security;

drop policy if exists "Users can view their own FOIA requests" on public.ticket_foia_requests;
create policy "Users can view their own FOIA requests"
  on public.ticket_foia_requests
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own FOIA requests" on public.ticket_foia_requests;
create policy "Users can create their own FOIA requests"
  on public.ticket_foia_requests
  for insert
  with check (auth.uid() = user_id);
