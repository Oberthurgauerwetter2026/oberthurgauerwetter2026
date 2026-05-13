## Ziel

Open-Meteo-Tageskontingent entlasten: Bodendruckkarte nur noch 1×/Tag um **06:00 UTC** automatisch erzeugen, manueller „Jetzt neu erzeugen"-Button wird entfernt.

## Änderungen

### 1. Cron-Schedule auf täglich 06:00 UTC umstellen

In `cron.job` den bestehenden Druckkarten-Job neu anlegen:
- Alten Job (vermutlich `generate-pressure-map-hourly` o. ä.) `unschedule`n.
- Neuer Job `generate-pressure-map-daily` mit Schedule `0 6 * * *`, ruft via `pg_net` die bestehende Route `/api/public/hooks/generate-pressure-map` auf der stabilen Production-URL auf.

Wird über das Supabase-Insert-Tool ausgeführt (kein Migration-File, da projektspezifische URL/Key).

### 2. Manuellen Button entfernen

In `src/routes/_app.settings.tsx` (`PressureMapCard`):
- Button „Jetzt neu erzeugen" + `regen()`-Handler + `running`-State entfernen.
- Beschreibungstext anpassen: „Cron-Lauf täglich um **06:00 UTC**", Hinweis auf manuelle Auslösung streichen.
- Status (letzter Lauf, letzter Status) und Vorschaubild bleiben erhalten.

In `src/lib/pressure-map.functions.ts`:
- `triggerPressureMap` entfernen (nicht mehr genutzt).
- `getPressureMapStatus` bleibt (Settings-Card liest weiterhin Status).

### 3. Was bleibt unverändert

- `src/server/pressure-map.server.ts` (Concurrency-Pool, Retry-Logik) — keine Änderung.
- `src/routes/api/public/hooks/generate-pressure-map.ts` (Hook-Route) — keine Änderung, wird vom neuen Cron weiterhin aufgerufen.
- Synoptik-Trend ECMWF+GFS — keine Änderung.
- Forecast-Logik / Eingeschränkter Modus — keine Änderung.
- `pressure_map_enabled`-Flag in `app_settings` — bleibt als Notbremse erhalten (Hook respektiert es bereits).

## Erwartetes Ergebnis

- OM-Verbrauch durch die Druckkarte sinkt von ~33'600/Tag (stündlich) auf **1'400/Tag** (~14 % des 10'000er-Limits).
- Forecast-Erstellung hat ganztags freien OM-Spielraum, der „Eingeschränkter Modus"-Hinweis sollte nicht mehr durch die Druckkarte ausgelöst werden.
- Karte ist täglich ab ca. 06:05 UTC (≈ 07/08 Uhr lokal) frisch verfügbar, gültig für 12 UTC des Folgetags.
- Settings-Seite zeigt nur noch Status + Vorschau, keine manuelle Auslösung mehr.
