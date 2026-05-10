## Ziel

Auf der Einstellungs-Seite (Admin-Bereich) ein kleines Widget anzeigen, das den heutigen Open-Meteo-Verbrauch und das verbleibende Tages-Kontingent darstellt — damit du jederzeit siehst, ob noch Prognosen erzeugt werden können.

## Was du sehen wirst

Eine Karte „Open-Meteo Tagesnutzung" mit:
- **Heute verbraucht:** z.B. `7'421 / 10'000 Calls`
- **Fortschrittsbalken** (grün < 70 %, gelb 70–90 %, rot > 90 %)
- **Aufschlüsselung nach Quelle** (Forecast, Pressure-Map, Radar, Snow-Line, Pressure-Gradient, Nowcast, Elevation)
- **Status:** „OK" / „Limit fast erreicht" / „Pausiert bis 00:00 UTC" (falls 429-Marker aktiv)
- **Letzter 429-Fehler** (Zeitstempel, falls vorhanden)

Reset täglich um 00:00 UTC (passt zum Open-Meteo-Limit).

## Umsetzung (technisch)

### 1. Neue Tabelle `openmeteo_usage`

```sql
create table public.openmeteo_usage (
  day date primary key,            -- UTC-Datum
  total int not null default 0,
  by_source jsonb not null default '{}'::jsonb,  -- {"forecast": 320, "pressure_map": 1344, ...}
  last_429_at timestamptz,
  last_429_source text,
  updated_at timestamptz not null default now()
);
alter table public.openmeteo_usage enable row level security;
create policy "admins read usage" on public.openmeteo_usage
  for select using (public.has_role(auth.uid(), 'admin'));
```

Schreibzugriff nur via `supabaseAdmin` (Server-seitig).

### 2. Zentraler Open-Meteo-Wrapper `src/server/openmeteo-quota.server.ts`

```ts
export async function fetchOpenMeteo(url: URL, source: OmSource): Promise<Response>
```

- Zählt jeden Aufruf in `openmeteo_usage` hoch (UTC-Tag, atomar via Postgres-Function `increment_om_usage(day, source, amount)`).
- Bei 429: `last_429_at` + `last_429_source` setzen.
- Wird von allen bestehenden Stellen genutzt (`forecast.functions.ts`, `pressure-map.server.ts`, `radar.server.ts`, `snow-line.server.ts`, `pressure-gradient.server.ts`, `nowcast.server.ts`).

Atomic-Counter via RPC, damit parallele Requests keine Werte verlieren.

### 3. Server-Function `getOpenMeteoUsage`

In `src/lib/admin-stats.functions.ts` (neu): liest die heutige Zeile + prüft den `om:ratelimit:*`-Marker im `weather_cache`. Liefert:

```ts
{ day, total, limit: 10000, bySource, last429At, last429Source, isRateLimited, resetAtIso }
```

Auth: nur Admin (gleiches Muster wie `triggerPressureMap`).

### 4. UI-Widget in `src/routes/_app.settings.tsx`

Neue Karte oben im Admin-Bereich. Polling alle 30 s via `useQuery`. Komponente in `src/components/OpenMeteoUsageCard.tsx` ausgelagert, damit der Settings-Route schlank bleibt.

## Was NICHT enthalten ist

- Kein Negativcache für die Forecast-Route (separate Frage; können wir danach machen).
- Keine Historie über mehrere Tage (nur „heute"). Alte Zeilen bleiben aber in der Tabelle für späteres Reporting erhalten.
- Keine Limit-Konfiguration in der UI — fix verdrahtet auf 10'000 (Open-Meteo-Free-Tier).

## Aufwand & Auswirkungen

- 1 Migration, 1 neue Server-Datei, 1 Wrapper-Refactor in 6 bestehenden Dateien (mechanisch, nur Aufruf umstellen), 1 neue Komponente, 1 Erweiterung in `_app.settings.tsx`.
- Kein Einfluss auf bestehende Forecast-Logik — der Wrapper ist transparent.
