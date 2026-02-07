-- Separate bucket for registration evidence receipts and screenshot artifacts.

insert into storage.buckets (id, name, public)
values ('registration-evidence', 'registration-evidence', false)
on conflict (id) do nothing;
