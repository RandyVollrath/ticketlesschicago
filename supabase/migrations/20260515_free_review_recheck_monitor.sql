-- Free review recheck monitoring.
--
-- Originally /free-ticket-review was a one-shot scrape: a user submitted
-- their plate, we hit the CHI PAY portal once, emailed results, done. But
-- the city portal has a real lag — a ticket written this morning often
-- doesn't appear in the portal for days. A user who scrapes today and sees
-- "no tickets" can still have a fresh ticket coming, and by the time it
-- shows up, mail-contest deadlines are already burning.
--
-- This migration turns the single row in free_review_requests into the
-- anchor for ongoing weekly monitoring: when a user opts in, we keep
-- re-scraping their plate every Monday and email them the moment a NEW
-- ticket appears (i.e. one that wasn't already in last_known_ticket_numbers).
-- Monitoring stops on explicit unsubscribe, OR silently when the email
-- becomes a paid Autopilot customer (so paid users don't get duplicate
-- free-tier nags — Autopilot's own pipeline takes over).

alter table free_review_requests
    add column if not exists monitor_enabled boolean not null default false,
    add column if not exists monitor_stopped_reason text
        check (monitor_stopped_reason is null
               or monitor_stopped_reason in ('unsubscribed', 'became_paid', 'no_email')),
    add column if not exists monitor_stopped_at timestamptz,
    add column if not exists last_rechecked_at timestamptz,
    add column if not exists last_known_ticket_numbers text[],
    add column if not exists recheck_count integer not null default 0,
    add column if not exists unsubscribe_token text;

-- The recheck cron pulls rows where monitor_enabled is true and we haven't
-- looked in the last ~6 days. Partial index keeps the scan tiny no matter
-- how big the table grows.
create index if not exists free_review_requests_monitor_due_idx
    on free_review_requests (last_rechecked_at nulls first)
    where monitor_enabled = true;

create unique index if not exists free_review_requests_unsubscribe_token_idx
    on free_review_requests (unsubscribe_token)
    where unsubscribe_token is not null;

comment on column free_review_requests.monitor_enabled is
'User opted into weekly rechecks (checkbox on the free-review form). Required to be true plus a non-null email for the recheck cron to consider this row.';

comment on column free_review_requests.last_known_ticket_numbers is
'CHI PAY ticket numbers already shown to the user — used to diff against the next scrape so we only email about NEW tickets, never re-announce ones from the original review.';

comment on column free_review_requests.monitor_stopped_reason is
'Null while monitoring is active. Set to unsubscribed (user clicked unsubscribe link), became_paid (their email is now a paid Autopilot customer — silent stop), or no_email (admin cleanup for rows with no contact).';
