ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS prompt_sky text,
  ADD COLUMN IF NOT EXISTS prompt_temp text,
  ADD COLUMN IF NOT EXISTS prompt_wind text;