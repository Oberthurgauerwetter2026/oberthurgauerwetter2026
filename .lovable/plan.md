## Problem

Open-Meteo gibt **drei verschiedene 429-Fehler** zurück: pro Minute, pro Stunde, pro Tag. Der aktuelle Code behandelt **jedes 429** als Tageslimit und sperrt die jeweilige Modellgruppe **bis 00:00 UTC** — auch wenn nur ein kurzer Burst-Limit (Minutenlimit) ausgelöst wurde.

In der Datenbank sind aktuell vier solche „bis Mitternacht"-Marker gesetzt, alle vom 03:23–03:24 UTC heute Morgen — vermutlich durch einen Burst beim parallelen Abruf von Forecast + Druckkarte:

```
om:ratelimit:pressure-map                                       → bis 2026-05-12 00:00 UTC
om:ratelimit:ecmwf_ifs025,gfs_global,icon_eu                    → bis 2026-05-12 00:00 UTC
om:ratelimit:meteoswiss_icon_ch2,arpege_europe                  → bis 2026-05-12 00:00 UTC
om:ratelimit:meteoswiss_icon_ch1,...,meteofrance_arome_france_hd → bis 2026-05-12 00:00 UTC
```

Folge: Forecast geht in „Eingeschränkter Modus" (MOSMIX-only), obwohl erst **16/10000** Tagescalls verbraucht sind.

## Lösung

### 1. Klassifizierung verfeinern (`forecast.functions.ts`, `fetchOpenMeteo`)

Aktuell: `if (status === 429 && /limit exceeded|quota/i.test(body)) → RATE_LIMIT`.
Open-Meteo-Texte: `Minutely`, `Hourly`, `Daily API request limit exceeded`. Alle matchen → falsch klassifiziert.

Neuer Error-Typ mit drei Stufen:
- `RATE_LIMIT_DAILY` — body matcht `/daily.*limit/i` → Marker bis 00:00 UTC (wie bisher)
- `RATE_LIMIT_HOURLY` — body matcht `/hourly.*limit/i` → Marker für **30 Min**
- `RATE_LIMIT_MINUTELY` — body matcht `/minutely.*limit/i` oder generisches 429 → Marker für **2 Min**, zusätzlich kurz retryen (wie heute, mit `Retry-After`)

### 2. TTL-abhängiger Negative-Cache (`fetchOpenMeteoOptional`)

`expires_at` für den Marker je nach Stufe setzen statt immer `nextUtcMidnightIso()`. Das bestehende Sicherheits-Filter „nur akzeptieren wenn auf 00:00 UTC" muss weg bzw. durch generisches `expires_at > now()` ersetzt werden, damit kürzere TTLs auch greifen.

### 3. Gleiches für Druckkarte (`pressure-map.server.ts`)

`setRateLimited()` aktuell hardcoded `nextUtcMidnightIso()`. Parametrisieren: nur bei „Daily" bis Mitternacht, sonst kurze TTL. Die Erkennung muss in den Batch-Loop wo 429 gezählt wird (Zeile ~173) — dort den Body inspizieren statt nur den Status.

### 4. Bestehende falsche Marker sofort löschen

Damit der User nicht bis 00:00 UTC warten muss:
```sql
DELETE FROM weather_cache WHERE cache_key LIKE 'om:ratelimit:%';
```
Wird als Migration ausgeführt.

### 5. Logging

Bei jedem 429 die erkannte Stufe + Body-Snippet + gesetzte TTL loggen, damit zukünftige Vorfälle leichter zu diagnostizieren sind.

## Nicht im Umfang

- Keine Änderung an `OpenMeteoUsageCard` — der zeigt korrekt den `om:ratelimit:pressure-map`-Marker. Sobald der gelöscht ist und nur noch bei echten Tageslimits gesetzt wird, verschwindet auch das rote Badge.
- Keine Änderung am Quota-Counter (`openmeteo_usage`) — der ist korrekt.
