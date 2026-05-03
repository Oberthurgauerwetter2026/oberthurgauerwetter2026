UPDATE public.app_settings
SET 
  models_shortterm = 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,icon_d2',
  models_midterm = 'meteoswiss_icon_ch2,icon_d2,icon_eu,ecmwf_ifs025',
  models_longterm = 'ecmwf_ifs025,gfs_global';