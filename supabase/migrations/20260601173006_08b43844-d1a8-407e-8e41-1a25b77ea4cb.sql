ALTER TABLE public.app_settings
  ALTER COLUMN models_shortterm SET DEFAULT 'meteoswiss_icon_ch1,meteoswiss_icon_ch2'::text,
  ALTER COLUMN models_midterm   SET DEFAULT 'meteoswiss_icon_ch2,ecmwf_ifs025,gfs_global'::text,
  ALTER COLUMN models_longterm  SET DEFAULT 'ecmwf_ifs025,gfs_global'::text;

UPDATE public.app_settings
SET models_shortterm = 'meteoswiss_icon_ch1,meteoswiss_icon_ch2'
WHERE models_shortterm IN (
  'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2',
  'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd'
);

UPDATE public.app_settings
SET models_midterm = 'meteoswiss_icon_ch2,ecmwf_ifs025,gfs_global'
WHERE models_midterm IN (
  'meteoswiss_icon_ch2,icon_d2,ecmwf_ifs025,arpege_europe,gfs_global',
  'meteoswiss_icon_ch2,arpege_europe'
);