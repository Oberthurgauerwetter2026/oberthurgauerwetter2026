ALTER TABLE public.app_settings 
  ADD COLUMN IF NOT EXISTS mosmix_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mosmix_stations text NOT NULL DEFAULT '10935,10929';