ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS bias_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bias_stations text NOT NULL DEFAULT 'GUT,STG,TAE',
  ADD COLUMN IF NOT EXISTS bias_lookback_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS bias_strength integer NOT NULL DEFAULT 70;