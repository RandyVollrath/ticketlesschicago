-- Add storage metadata and screenshot artifact path for registration receipts.

alter table if exists public.registration_evidence_receipts
  add column if not exists storage_bucket text,
  add column if not exists screenshot_path text;
