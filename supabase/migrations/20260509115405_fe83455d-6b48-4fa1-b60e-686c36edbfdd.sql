ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS tag2_weight_mosmix integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS tag2_weight_om integer NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS tag3plus_weight_mosmix integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS tag3plus_weight_om integer NOT NULL DEFAULT 55;

ALTER TABLE public.app_settings ALTER COLUMN tag0_weight_mosmix SET DEFAULT 0;
ALTER TABLE public.app_settings ALTER COLUMN tag0_weight_om SET DEFAULT 100;
ALTER TABLE public.app_settings ALTER COLUMN tag1_weight_mosmix SET DEFAULT 0;
ALTER TABLE public.app_settings ALTER COLUMN tag1_weight_om SET DEFAULT 100;