-- Heartbeat row written by the free-review worker on every loop iteration.
-- One row per worker_id. The API reads this so it can tell the page whether
-- the queue is being drained (recent heartbeat) or appears to be offline
-- (no heartbeat in the last 2 minutes).

create table if not exists free_review_worker_heartbeat (
    worker_id text primary key,
    last_seen_at timestamptz not null default now(),
    -- Snapshot of queue state at the moment of the heartbeat (advisory)
    pending_count integer,
    processing_count integer,
    -- Build identifier so we can spot stuck old workers after a deploy
    worker_version text
);

create index if not exists free_review_worker_heartbeat_last_seen_idx
    on free_review_worker_heartbeat (last_seen_at desc);

alter table free_review_worker_heartbeat enable row level security;

create policy "free_review_worker_heartbeat_service_all"
    on free_review_worker_heartbeat for all
    to service_role
    using (true) with check (true);

comment on table free_review_worker_heartbeat is
'Liveness heartbeat written by the always-on free-review worker. The API checks the most recent row to decide whether the page should show "processing…" or "system briefly offline."';
