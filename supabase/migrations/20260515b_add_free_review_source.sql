-- Track which surface enqueued each free-review request.
--
-- /free-ticket-review (public analysis) and /free-contest (password-gated
-- letter generation) share the same scraper queue (free_review_requests),
-- but they finish on different pages. The worker uses this column to send
-- the user a results-ready email pointing at the correct landing page.

alter table free_review_requests
  add column if not exists source text not null default 'free_ticket_review'
  check (source in ('free_ticket_review', 'free_contest'));

create index if not exists free_review_requests_source_idx
  on free_review_requests (source);
