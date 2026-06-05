ALTER TABLE public.app_settings ALTER COLUMN models_shortterm SET DEFAULT 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,meteofrance_arome_france';
ALTER TABLE public.app_settings ALTER COLUMN models_midterm SET DEFAULT 'meteoswiss_icon_ch2,meteofrance_arome_france,ecmwf_ifs025,gfs_global';
ALTER TABLE public.app_settings ALTER COLUMN models_longterm SET DEFAULT 'ecmwf_ifs025,gfs_global,icon_eu';
UPDATE public.app_settings
SET models_shortterm = 'meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd,meteofrance_arome_france',
    models_midterm   = 'meteoswiss_icon_ch2,meteofrance_arome_france,ecmwf_ifs025,gfs_global',
    models_longterm  = 'ecmwf_ifs025,gfs_global,icon_eu',
    updated_at = now();