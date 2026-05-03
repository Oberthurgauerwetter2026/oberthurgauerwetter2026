ALTER TABLE public.app_settings 
  ALTER COLUMN models_shortterm SET DEFAULT 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2',
  ALTER COLUMN models_midterm SET DEFAULT 'meteoswiss_icon_ch2,icon_d2,icon_eu,ecmwf_ifs025';

UPDATE public.app_settings
SET 
  models_shortterm = CASE WHEN position('icon_d2' in models_shortterm) = 0 
                          THEN models_shortterm || ',icon_d2' ELSE models_shortterm END,
  models_midterm = CASE WHEN position('icon_d2' in models_midterm) = 0 
                        THEN 'meteoswiss_icon_ch2,icon_d2,' || regexp_replace(models_midterm, '^meteoswiss_icon_ch2,?', '') 
                        ELSE models_midterm END;