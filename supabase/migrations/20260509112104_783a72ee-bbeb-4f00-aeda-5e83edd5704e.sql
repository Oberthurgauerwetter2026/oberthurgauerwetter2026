ALTER TABLE public.app_settings
  ALTER COLUMN models_shortterm SET DEFAULT 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd',
  ALTER COLUMN models_midterm   SET DEFAULT 'meteoswiss_icon_ch2,arpege_europe',
  ALTER COLUMN models_longterm  SET DEFAULT 'ecmwf_ifs025,gfs_global';