ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS tag1_weight_mosmix integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS tag1_weight_om integer NOT NULL DEFAULT 50;