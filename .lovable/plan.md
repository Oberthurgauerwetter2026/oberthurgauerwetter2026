## Ziel

Wenn der Open-Meteo-Endpoint geblockt ist (shared_ip_daily / hourly / minutely / network), sollen Forecast, Nowcast und Bias-Korrektur **aus dem R2-Cache** bedient werden — statt eines synthetischen 429, das die UI in den "letzter gültiger Cache"-Pfad zwingt.

Der Reader `loadOpenMeteoCache()` existiert bereits, R2 ist befüllt, `R2_PUBLIC_URL` ist als Secret gesetzt.

## Vorgehen

### 1. Grid-Picker in `src/server/openmeteo-cache.server.ts`

Neue Helfer:
- `pickNearest(payload, lat, lon)` → liefert `{ index, phaseA, phaseB, phaseC }` für den nächstgelegenen Gridpunkt (einfaches Haversine über `payload.grid.points`).
- `cacheCoversLatLon(payload, lat, lon)` → true wenn (lat, lon) innerhalb der BBox + Toleranz.

### 2. Throttle-Fallback in `fetchOpenMeteo` (`openmeteo-quota.server.ts`)

In `syntheticThrottleResponse()` bzw. davor: wenn `source ∈ { "forecast", "nowcast", "historical_bias" }`, vor dem 429-Synth versuchen, aus R2 zu antworten:
- URL parsen (`latitude`, `longitude`, ggf. `forecast_minutely_15`, `past_days`).
- Über `pickNearest` den passenden Phase-Block (A / B / C) ziehen.
- Als `Response(200)` mit Header `x-om-source: r2-cache` und `x-om-cache-age-min: <n>` zurückgeben.
- Bei Miss → wie bisher 429.

Zusätzlich: **auch bei `fetch()`-Fehler** (Network throw) denselben Fallback-Versuch starten, statt sofort weiterzuwerfen.

### 3. Telemetrie

- Bei R2-Hit: `recordUsage(source, 0, false)` nicht zählen — stattdessen neue Spalte `r2_hits` via vorhandenem `increment_om_usage`-RPC? **Verzicht** für Welle 1 — nur Log: `[openmeteo-cache] served <source> from R2 (age=<n>min)`.

### 4. Forecast-Response markieren

In `forecast.functions.ts` (Hot-Path): wenn die Tagesdaten aus R2 stammen (Header-Check am `Response` durchreichen ist umständlich → einfacher: nach dem Fetch in `fetchOpenMeteo()`-Wrapper das `x-om-source: r2-cache`-Header lesen und ans Tagesobjekt `data_source: "r2_cache"` + `cache_age_min` hängen). Wird im UI als Badge "Cache" angezeigt (kommt später).

### 5. Persistenz bei degradiertem Cache

Bisheriger Bug laut Incident: "wird nicht degradiert gespeichert". Im `getOrSetCacheWithStale`-Pfad (weather-cache.server) prüfen, ob das Resultat ein R2-Fallback war — falls ja, mit kürzerer TTL (5 min statt voll) schreiben, damit nach Throttle-Ende schnell wieder frischer Live-Call kommt.

## Nicht im Scope (Welle 2)

- Worker komplett auf R2-Only (kein Open-Meteo mehr) umstellen.
- Pressure-Map / Snow-Line / Synoptic-Trend an R2 hängen (zu kleine Region oder andere Variablen).
- UI-Badge "aus Cache geladen".

## Technische Details

```text
fetchOpenMeteo(url, source)
  ├─ throttle.active? ──► tryR2(url, source) ──hit──► 200 (x-om-source: r2-cache)
  │                                          └─miss─► synthetic 429
  ├─ fetch() throw ───── tryR2(url, source) ──hit──► 200
  │                                          └─miss─► rethrow
  └─ 200 OK ───────────► passthrough
```

Phasen-Mapping aus URL-Parametern:
- `minutely_15` enthalten → Phase B (Nowcast)
- `past_days >= 7` → Phase C (Bias)
- sonst → Phase A (Forecast)

## Dateien

- `src/server/openmeteo-cache.server.ts` — Grid-Picker + `tryR2ForUrl()` exportieren.
- `src/server/openmeteo-quota.server.ts` — Fallback in `fetchOpenMeteo()` einhängen.
- `src/server/weather-cache.server.ts` — TTL-Reduktion bei R2-Origin.
- ggf. `src/server/forecast.functions.ts` — `data_source`/`cache_age_min` ans Day-Objekt.
