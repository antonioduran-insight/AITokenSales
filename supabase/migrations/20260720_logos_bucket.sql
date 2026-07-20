-- Storage bucket for organization logos.
-- Fixes "Bucket not found" when uploading a logo from Settings → Organization.
-- Run this in the Supabase SQL editor (or via the CLI) against the project.

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- Postgres does not support CREATE POLICY IF NOT EXISTS, so drop-then-create.
DROP POLICY IF EXISTS "Public logos viewable" ON storage.objects;
CREATE POLICY "Public logos viewable" ON storage.objects
  FOR SELECT USING (bucket_id = 'logos');

DROP POLICY IF EXISTS "Auth users upload logos" ON storage.objects;
CREATE POLICY "Auth users upload logos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'logos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Auth users update logos" ON storage.objects;
CREATE POLICY "Auth users update logos" ON storage.objects
  FOR UPDATE USING (bucket_id = 'logos' AND auth.role() = 'authenticated');
