
create table if not exists public.openmeteo_usage (
  day date primary key,
  total integer not null default 0,
  by_source jsonb not null default '{}'::jsonb,
  last_429_at timestamptz,
  last_429_source text,
  updated_at timestamptz not null default now()
);

alter table public.openmeteo_usage enable row level security;

create policy "Admins read openmeteo_usage"
  on public.openmeteo_usage
  for select
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.increment_om_usage(
  _day date,
  _source text,
  _amount integer,
  _is_429 boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.openmeteo_usage (day, total, by_source, last_429_at, last_429_source, updated_at)
  values (
    _day,
    _amount,
    jsonb_build_object(_source, _amount),
    case when _is_429 then now() else null end,
    case when _is_429 then _source else null end,
    now()
  )
  on conflict (day) do update
  set total = public.openmeteo_usage.total + _amount,
      by_source = jsonb_set(
        public.openmeteo_usage.by_source,
        array[_source],
        to_jsonb(coalesce((public.openmeteo_usage.by_source ->> _source)::int, 0) + _amount),
        true
      ),
      last_429_at = case when _is_429 then now() else public.openmeteo_usage.last_429_at end,
      last_429_source = case when _is_429 then _source else public.openmeteo_usage.last_429_source end,
      updated_at = now();
end;
$$;
