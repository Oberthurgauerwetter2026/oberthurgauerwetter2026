
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'editor');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- is_authenticated_staff (admin OR editor)
CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','editor')
  )
$$;

-- Forecasts (one per generation)
CREATE TABLE public.forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES auth.users(id),
  wp_post_id BIGINT,
  wp_post_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_forecasts_date ON public.forecasts(forecast_date DESC);
ALTER TABLE public.forecasts ENABLE ROW LEVEL SECURITY;

-- Forecast entries (one per day/section)
CREATE TABLE public.forecast_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID NOT NULL REFERENCES public.forecasts(id) ON DELETE CASCADE,
  position INT NOT NULL,
  entry_date DATE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  weather_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entries_forecast ON public.forecast_entries(forecast_id, position);
ALTER TABLE public.forecast_entries ENABLE ROW LEVEL SECURITY;

-- App settings (single row keyed by id)
CREATE TABLE public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wp_site_url TEXT,
  wp_username TEXT,
  wp_target_slug TEXT DEFAULT 'wetterbericht',
  wp_target_page_id BIGINT,
  location_name TEXT DEFAULT 'Amriswil',
  location_lat DOUBLE PRECISION DEFAULT 47.5469,
  location_lon DOUBLE PRECISION DEFAULT 9.2986,
  radius_km INT DEFAULT 15,
  ai_prompt_template TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_forecasts_updated BEFORE UPDATE ON public.forecasts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_entries_updated BEFORE UPDATE ON public.forecast_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== RLS POLICIES =====

-- profiles
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins update all profiles" ON public.profiles
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- user_roles
CREATE POLICY "Users see own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins see all roles" ON public.user_roles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- forecasts
CREATE POLICY "Staff read forecasts" ON public.forecasts
  FOR SELECT USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff insert forecasts" ON public.forecasts
  FOR INSERT WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff update forecasts" ON public.forecasts
  FOR UPDATE USING (public.is_staff(auth.uid()));
CREATE POLICY "Admins delete forecasts" ON public.forecasts
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- forecast_entries
CREATE POLICY "Staff read entries" ON public.forecast_entries
  FOR SELECT USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff insert entries" ON public.forecast_entries
  FOR INSERT WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff update entries" ON public.forecast_entries
  FOR UPDATE USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff delete entries" ON public.forecast_entries
  FOR DELETE USING (public.is_staff(auth.uid()));

-- app_settings
CREATE POLICY "Staff read settings" ON public.app_settings
  FOR SELECT USING (public.is_staff(auth.uid()));
CREATE POLICY "Admins write settings" ON public.app_settings
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed single settings row
INSERT INTO public.app_settings (ai_prompt_template) VALUES (
  'Du bist ein Schweizer Wettermoderator für die Region Oberthurgau (Amriswil, Bodensee). Schreibe einen kompakten, redaktionellen Wetterbericht in gepflegtem Schweizer Hochdeutsch (kein "ß"). Nüchtern, präzise, ohne Floskeln. Erwähne Temperatur, Niederschlag, Wind und Bewölkung in fliessendem Text – keine Aufzählungen.'
);
