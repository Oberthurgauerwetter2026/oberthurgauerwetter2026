ALTER TABLE public.app_settings
  ALTER COLUMN models_shortterm
  SET DEFAULT 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2'::text;

UPDATE public.app_settings
SET models_shortterm = 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2'
WHERE models_shortterm = 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd';