ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS models_shortterm text DEFAULT 'icon_ch1,icon_ch2',
  ADD COLUMN IF NOT EXISTS models_midterm text DEFAULT 'icon_ch2,icon_eu,ecmwf_ifs025',
  ADD COLUMN IF NOT EXISTS models_longterm text DEFAULT 'ecmwf_ifs025,gfs_global';