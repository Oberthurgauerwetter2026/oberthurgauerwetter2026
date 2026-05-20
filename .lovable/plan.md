# Open-Meteo Verbrauch senken (Option 2: Cache-TTLs erhöhen)

Ziel: Anzahl der Open-Meteo-Calls pro Tag in **diesem** Projekt deutlich reduzieren, damit das tägliche Limit (10'000/Tag, geteilt mit anderen Projekten auf derselben Cloudflare-IP) seltener gerissen wird. Kein Funktionsverlust, nur weniger Doppelabfragen.

## Aktueller Stand (was bereits gecacht ist)

| Modul                | Cache | TTL                       |
|----------------------|-------|---------------------------|
| Forecast Short-Tier  | nein  | live bei jedem Aufruf     |
| Forecast Mid-Tier    | ja    | bis Mitternacht Zürich    |
| Forecast Long-Tier   | ja    | bis Mitternacht Zürich    |
| Nowcast (current)    | ja    | 10 min                    |
| Snow line            | ja    | 60 min                    |
| Pressure gradient    | ja    | 60 min                    |
| Synoptic trend       | ja    | bis Mitternacht           |
| Radar                | ja    | 5 min                     |
| Pressure map (cron)  | ja    | gesteuert via Cron        |

Größter Hebel: **Short-Tier ist ungecacht** — jeder Forecast-Aufruf zieht 1 frischen Call. Bei mehrfachen Aufrufen pro Stunde (Vorschau, Reload, Tests) summiert sich das.

## Änderungen

### 1. Short-Tier Forecast cachen (Hauptmaßnahme)
In `src/server/forecast.functions.ts` (Zeile 963):
- `shortData` mit `getOrSetCache` umhüllen, **TTL 15 Minuten**.
- Cache-Key: `om:short:${lat.toFixed(4)},${lon.toFixed(4)}:${shortModels}`.
- 15 min ist ein guter Kompromiss: ICON-CH1/CH2 wird ohnehin nur stündlich aktualisiert, AROME alle 3 h.

### 2. Nowcast TTL anheben
In `src/server/nowcast.server.ts` (Zeile 49):
- `10 * 60 * 1000` → `20 * 60 * 1000` (20 min).
- Open-Meteo "current" aktualisiert sich seltener als alle 10 min effektiv; 20 min ist ausreichend genau.

### 3. Radar TTL anheben
In `src/server/radar.server.ts` (Zeile 126):
- `5 * 60 * 1000` → `10 * 60 * 1000` (10 min).
- MeteoSwiss-Radar liefert neue Bilder alle ~5 min; 10 min Cache verdoppelt Hit-Rate ohne spürbaren Datenverlust.

### 4. Cache-Hit-Rate im Admin sichtbar machen
In `src/lib/admin-stats.functions.ts` neue Felder zu `getOpenMeteoUsage` hinzufügen:
- `cacheEntries`: Anzahl gültiger Einträge in `weather_cache` mit Prefix `om:` (ohne `om:ratelimit:`).
- `cacheByPrefix`: Aufschlüsselung `{ short: n, mid: n, long: n, current: n, snowline: n, ... }`.

In `src/components/OpenMeteoUsageCard.tsx`:
- Neue Zeile "Aktive Cache-Einträge: X (short Y · mid Z · …)".

## Erwartete Wirkung

- **Short-Tier-Cache (15 min):** Bei z.B. 10 Aufrufen/h → vorher 10 Calls, nachher 4 Calls. **−60% auf den größten Verursacher.**
- **Nowcast 10→20 min:** −50% auf diese Quelle.
- **Radar 5→10 min:** −50% auf diese Quelle.

Realistisch: 30–50% weniger Open-Meteo-Calls pro Tag aus diesem Projekt.

## Was NICHT geändert wird

- Keine DB-Migration.
- Keine neuen Secrets.
- Keine UI-Logik außer der zusätzlichen Anzeige im Admin.
- Keine Änderung am Cron oder an der Druckkarte (laufen schon mit eigenem Throttling).
- Mid/Long-Tier TTL (schon Mitternacht — kann nicht sinnvoll länger).

## Technische Details

- `getOrSetCache(key, fetcher, ttlMs?)` existiert bereits in `src/server/weather-cache.server.ts` und schreibt in die Tabelle `weather_cache` (Spalten `cache_key`, `payload`, `expires_at`).
- Negative-Cache (`om:ratelimit:*`) bleibt unverändert — der Short-Tier-Cache liegt davor: erst Cache prüfen, dann erst `fetchOpenMeteoOptional` (das wiederum die negative-cache-Logik enthält).
- 4 Nachkommastellen bei Koordinaten ≈ 11 m Genauigkeit → identische Settings treffen denselben Cache-Eintrag.
