ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS tag0_weight_mosmix integer NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS tag0_weight_om integer NOT NULL DEFAULT 60;