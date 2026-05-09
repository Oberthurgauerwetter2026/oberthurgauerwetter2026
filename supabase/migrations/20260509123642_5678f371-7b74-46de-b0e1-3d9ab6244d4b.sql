-- Storage bucket for generated weather maps (publicly readable)
INSERT INTO storage.buckets (id, name, public)
VALUES ('weather-maps', 'weather-maps', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read of the bucket
DROP POLICY IF EXISTS "Public read weather-maps" ON storage.objects;
CREATE POLICY "Public read weather-maps"
ON storage.objects FOR SELECT
USING (bucket_id = 'weather-maps');

-- Admins can write/update/delete in the bucket (server uses service role anyway, but keep tight RLS)
DROP POLICY IF EXISTS "Admins write weather-maps" ON storage.objects;
CREATE POLICY "Admins write weather-maps"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'weather-maps' AND has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update weather-maps" ON storage.objects;
CREATE POLICY "Admins update weather-maps"
ON storage.objects FOR UPDATE
USING (bucket_id = 'weather-maps' AND has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete weather-maps" ON storage.objects;
CREATE POLICY "Admins delete weather-maps"
ON storage.objects FOR DELETE
USING (bucket_id = 'weather-maps' AND has_role(auth.uid(), 'admin'));

-- Settings columns for the pressure map
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS pressure_map_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pressure_map_last_run timestamptz,
  ADD COLUMN IF NOT EXISTS pressure_map_last_status text;