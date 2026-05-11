-- Camera-ticket evidence pulled from the City's vendor portals
-- (chicagophotociteweb.com for red-light, violationinfo.com for speed)
-- and the structured AI analysis of the imagery.
--
-- One row per (ticket_id) — re-scraping replaces the row.
-- Photos and video bytes live in the `ticket-photos` Supabase Storage bucket;
-- this table only holds metadata + the AI findings + the storage paths.

create table if not exists camera_evidence (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null unique references detected_tickets(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,

    -- Which portal we scraped
    source text not null check (source in ('red_light', 'speed_camera', 'parking_photo')),

    -- Image / video assets (paths inside the `ticket-photos` storage bucket)
    image_paths text[] not null default '{}'::text[],
    video_paths text[] not null default '{}'::text[],
    image_source_urls text[] not null default '{}'::text[],
    video_source_urls text[] not null default '{}'::text[],

    -- AI findings (shape matches lib/camera-evidence-analysis.ts CameraEvidenceFindings)
    findings jsonb,

    -- Diagnostic notes when the scraper returned nothing
    notes text[] not null default '{}'::text[],

    scraped_at timestamptz not null default now(),
    analyzed_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists camera_evidence_ticket_id_idx on camera_evidence (ticket_id);
create index if not exists camera_evidence_user_id_idx on camera_evidence (user_id);
create index if not exists camera_evidence_source_idx on camera_evidence (source);

-- RLS: users see their own rows, service role sees everything
alter table camera_evidence enable row level security;

create policy "camera_evidence_user_select"
    on camera_evidence for select
    to authenticated
    using (user_id = auth.uid());

create policy "camera_evidence_service_all"
    on camera_evidence for all
    to service_role
    using (true) with check (true);

comment on table camera_evidence is
'Photos, video, and AI findings from the City of Chicago camera-ticket evidence portals.
Source: scrapeRedLightEvidence / scrapeSpeedCameraEvidence in lib/camera-evidence-scraper.ts.
Findings produced by analyzeCameraEvidence in lib/camera-evidence-analysis.ts.';
