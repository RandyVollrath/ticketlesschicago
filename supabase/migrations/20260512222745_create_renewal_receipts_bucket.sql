-- Storage bucket for renewal automation receipts (confirmation screenshots,
-- downloaded receipt PDFs). Private — accessed via signed URLs only.

INSERT INTO storage.buckets (id, name, public)
VALUES ('renewal-receipts', 'renewal-receipts', false)
ON CONFLICT (id) DO NOTHING;
