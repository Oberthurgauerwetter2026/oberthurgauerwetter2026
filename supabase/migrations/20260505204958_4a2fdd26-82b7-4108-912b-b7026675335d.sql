ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS nowcast_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nowcast_obs_horizon_h integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS night_clear_cooling_c numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS bias_per_hour_enabled boolean NOT NULL DEFAULT true;