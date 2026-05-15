-- Two unrelated-but-co-shipping additions to free_review_requests.
--
-- 1. `source` — the endpoint POST now distinguishes between /free-ticket-review
--    submissions (default) and /free-contest submissions, so the results email
--    can deep-link the user back to the right tool. Constraint-locked so a
--    future surface can't quietly inject a third value the worker doesn't
--    know how to render.
--
-- 2. Drip campaign columns — free-review users (Amanda-style: gave us email,
--    got "no tickets," walked away) are now enrolled in a 2-email nurture
--    campaign mirroring the FOIA-style drip:
--
--      Day 3 — educational, no pitch. Chicago ticket math.
--      Day 7 — soft pitch. Autopilot at $79/yr.
--
--    Same shape as foia_history_requests.drip_day3_sent_at / drip_day7_sent_at.
--    drip_unsubscribed is the user-facing kill switch; it's flipped by the
--    existing /api/contest/free-review-unsubscribe handler so a single click
--    stops both the weekly recheck AND the drip.

alter table free_review_requests
    add column if not exists source text not null default 'free_ticket_review'
        check (source in ('free_ticket_review', 'free_contest')),
    add column if not exists drip_day3_sent_at timestamptz,
    add column if not exists drip_day7_sent_at timestamptz,
    add column if not exists drip_unsubscribed boolean not null default false;

-- Drip cron pulls rows where the right day has elapsed AND that day-marker
-- is null. Partial indexes keep the scans cheap.
create index if not exists free_review_requests_drip_day3_due_idx
    on free_review_requests (created_at)
    where drip_day3_sent_at is null and drip_unsubscribed = false and email is not null;

create index if not exists free_review_requests_drip_day7_due_idx
    on free_review_requests (created_at)
    where drip_day7_sent_at is null and drip_unsubscribed = false and email is not null;

comment on column free_review_requests.source is
'Which entry point enqueued this row. Controls the deep link in the results-ready email so /free-contest submissions go back to /free-contest?review=<id> and /free-ticket-review submissions go back to /free-ticket-review?id=<id>.';

comment on column free_review_requests.drip_unsubscribed is
'User clicked the unsubscribe link in any of our follow-up emails. When true, suppresses both the weekly recheck AND the educational drip — one click stops every email.';
