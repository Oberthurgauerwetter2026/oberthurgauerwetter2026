
-- 1. app_settings: restrict reads to admins only (WP credentials)
DROP POLICY IF EXISTS "Staff read settings" ON public.app_settings;
CREATE POLICY "Admins read settings"
ON public.app_settings
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- 2. weather-maps storage: replace broad public-read with single-file read (prevents listing)
DROP POLICY IF EXISTS "Public read weather-maps" ON storage.objects;
CREATE POLICY "Public read pressure map file"
ON storage.objects
FOR SELECT
USING (bucket_id = 'weather-maps' AND name = 'europe-pressure-latest.svg');

-- 3. weather_cache: explicit deny-all (server-side only via service role)
CREATE POLICY "No client access to weather_cache"
ON public.weather_cache
FOR ALL
USING (false)
WITH CHECK (false);

-- 4. Revoke EXECUTE on SECURITY DEFINER functions from public roles
REVOKE EXECUTE ON FUNCTION public.increment_om_usage(date, text, integer, boolean) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_with_first_admin() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;
-- has_role and is_staff are used inside RLS policies; keep them executable by authenticated only, revoke from anon
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon, public;
