-- Free contest letter submissions (password-gated lead capture).
--
-- A visitor on /free-contest enters ticket + contact info, the API generates
-- a mail-in contest letter using DEFENSE_TEMPLATES, and we save the full
-- submission here so we can follow up about Autopilot ($79/yr).
--
-- The page itself is gated by FREE_CONTEST_PASSWORD env var; everyone who
-- lands here is at least "warm" — we wanted them to scroll past the gate.

create table if not exists free_contest_submissions (
    id uuid primary key default gen_random_uuid(),

    -- Contact (email is required so we can follow up)
    email text not null,
    full_name text not null,
    mailing_address text not null,
    mailing_city text not null,
    mailing_state text not null,
    mailing_zip text not null,

    -- Vehicle
    plate text not null,
    plate_state text not null default 'IL',

    -- Ticket
    ticket_number text not null,
    violation_date text not null,
    violation_type text not null,
    violation_description text,
    amount text,
    location text,

    -- What we returned to the user (audit + replay)
    letter text,
    defense_type text,

    -- Best-effort source identifiers
    ip text,
    user_agent text,

    -- Lifecycle for outreach pipeline
    followup_status text not null default 'new'
        check (followup_status in ('new', 'emailed', 'converted', 'unsubscribed', 'bounced')),
    followed_up_at timestamptz,

    created_at timestamptz not null default now()
);

create index if not exists free_contest_submissions_email_idx
    on free_contest_submissions (email);

create index if not exists free_contest_submissions_followup_idx
    on free_contest_submissions (followup_status, created_at);

create index if not exists free_contest_submissions_plate_idx
    on free_contest_submissions (plate, plate_state);

-- RLS: nobody reads directly; the API uses the service-role key.
alter table free_contest_submissions enable row level security;

create policy "free_contest_submissions_service_all"
    on free_contest_submissions for all
    to service_role
    using (true) with check (true);

comment on table free_contest_submissions is
'Lead capture for the password-gated /free-contest tool. Stores everything the visitor entered plus the letter we generated, so we can email them later about Autopilot.';
