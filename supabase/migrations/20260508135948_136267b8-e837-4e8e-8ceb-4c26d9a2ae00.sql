ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS lightning_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lightning_radius_km integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS ensemble_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ensemble_min_day integer NOT NULL DEFAULT 2;