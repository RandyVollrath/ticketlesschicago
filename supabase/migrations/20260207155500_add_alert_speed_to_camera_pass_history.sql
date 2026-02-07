-- Captures speed at the most recent camera audio cue to compare
-- prompted speed vs speed at camera pass time.

alter table if exists public.camera_pass_history
  add column if not exists alerted_at timestamptz,
  add column if not exists alert_speed_mps double precision,
  add column if not exists alert_speed_mph double precision;

create index if not exists idx_camera_pass_history_alerted_at
  on public.camera_pass_history (alerted_at desc);
