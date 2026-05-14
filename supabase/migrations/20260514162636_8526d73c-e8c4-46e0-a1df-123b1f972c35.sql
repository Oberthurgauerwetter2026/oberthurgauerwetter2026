ALTER TABLE public.app_settings
  DROP COLUMN IF EXISTS tag0_weight_mosmix,
  DROP COLUMN IF EXISTS tag0_weight_om,
  DROP COLUMN IF EXISTS tag1_weight_mosmix,
  DROP COLUMN IF EXISTS tag1_weight_om;