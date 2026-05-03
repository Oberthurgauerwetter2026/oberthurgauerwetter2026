CREATE TABLE public.weather_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_weather_cache_expires ON public.weather_cache (expires_at);

ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;
-- Keine Policies: Tabelle wird ausschließlich von Server-Funktionen über den Service-Role-Client genutzt.