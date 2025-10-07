-- Create storage bucket for ticket photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-photos', 'ticket-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can upload their own ticket photos
CREATE POLICY "Users can upload ticket photos"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'ticket-photos' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Users can view their own ticket photos
CREATE POLICY "Users can view own ticket photos"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'ticket-photos' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Admins can view all ticket photos
CREATE POLICY "Admins can view all ticket photos"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'ticket-photos' AND
    auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'carenvollrath@gmail.com')
  );
