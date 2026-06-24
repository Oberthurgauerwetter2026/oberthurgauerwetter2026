CREATE TABLE public.ai_text_cache (
  cache_key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

GRANT ALL ON public.ai_text_cache TO service_role;

ALTER TABLE public.ai_text_cache ENABLE ROW LEVEL SECURITY;

CREATE INDEX ai_text_cache_expires_at_idx ON public.ai_text_cache (expires_at);