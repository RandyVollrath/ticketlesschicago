-- Free ticket-contest review requests (public, unauthenticated).
--
-- A user enters their plate + state + last name on /free-ticket-review,
-- we enqueue a row here, an out-of-Vercel worker (scripts/process-free-review-queue.ts)
-- runs the CHI PAY portal scraper, evaluates each returned ticket against
-- the contest-kit policy engine, and writes the analysis back. The page
-- polls GET /api/contest/free-review?id=... until status='done'.
--
-- The portal scraper requires Playwright (~300MB) so it cannot run on Vercel.
-- That's why this is a queue table instead of a synchronous request.

create table if not exists free_review_requests (
    id uuid primary key default gen_random_uuid(),

    -- Portal lookup inputs (CHI PAY API requires all three)
    plate text not null,
    state text not null default 'IL',
    last_name text not null,

    -- Optional contact for email-when-ready (not required to submit)
    email text,

    -- Best-effort source identifiers — no auth on this endpoint
    ip text,
    user_agent text,

    -- Queue state machine: pending → processing → (done | error)
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'done', 'error')),

    -- Worker that claimed the row + when (so stale claims can be released)
    worker_id text,
    claimed_at timestamptz,

    -- Raw scrape from lookupPlateOnPortal() — array of PortalTicket
    portal_response jsonb,

    -- Per-ticket analysis: contest-kit recommendation, standard template,
    -- and the "beyond template" arguments specific to this ticket.
    analysis jsonb,

    -- Error message if status='error'
    error_message text,

    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists free_review_requests_status_idx
    on free_review_requests (status, created_at)
    where status in ('pending', 'processing');

create index if not exists free_review_requests_plate_idx
    on free_review_requests (plate, state);

-- RLS: nobody reads directly; the API endpoint uses the service-role key
-- and gates access by request id.
alter table free_review_requests enable row level security;

create policy "free_review_requests_service_all"
    on free_review_requests for all
    to service_role
    using (true) with check (true);

comment on table free_review_requests is
'Queue for the public free ticket-contest review tool. Workers process pending rows by scraping the CHI PAY portal and running the contest-kits policy engine, then writing analysis back. The page polls by id.';
