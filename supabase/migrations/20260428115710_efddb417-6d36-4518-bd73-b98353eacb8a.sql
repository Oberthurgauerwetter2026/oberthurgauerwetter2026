ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS topo_elev_min double precision,
  ADD COLUMN IF NOT EXISTS topo_elev_max double precision,
  ADD COLUMN IF NOT EXISTS topo_elev_median double precision;