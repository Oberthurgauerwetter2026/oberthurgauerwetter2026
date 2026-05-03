ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS radar_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS radar_radius_km integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS radar_correction_strength integer NOT NULL DEFAULT 70;