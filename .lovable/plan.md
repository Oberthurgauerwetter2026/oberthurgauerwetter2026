## Befund

Open-Meteo hat heute drei `DAILY`-429-Antworten geschickt — aber **unsere eigene Nutzung liegt bei nur 36/10 000 Calls**. Es ist also nicht unser Tageslimit, sondern der **Shared-IP-Throttle der Cloudflare-Worker-Egress-IP** (andere Tenants haben das Daily-Bucket für die geteilte IP gefüllt).

Trotzdem stehen in `weather_cache` drei Negative-Marker, die bis **00:00 UTC (= 02:00 Schweizer Zeit)** alle drei Forecast-Tiers blockieren:

```
om:ratelimit:meteoswiss_icon_ch1,…icon_d2            → bis 23.05. 00:00 UTC
om:ratelimit:meteoswiss_icon_ch2,arpege_europe        → bis 23.05. 00:00 UTC
om:ratelimit:ecmwf_ifs025,gfs_global,icon_eu          → bis 23.05. 00:00 UTC
```

Daher der „Eingeschränkter Modus"-Banner.

Für die **Druckkarte** gibt es bereits die richtige Logik (`isLikelySharedIpThrottle` in `src/server/pressure-map.server.ts`, Z. 108–120 + 128–152): bei `daily`-429 mit Eigen-Nutzung < 500 Calls wird der Marker nur 45 min gesetzt, nicht bis Mitternacht. Im **Forecast-Pfad** (`src/server/forecast.functions.ts`, `fetchOpenMeteoOptional` Z. 901–949) fehlt diese Heuristik — dort wird `RATE_LIMIT_DAILY` blind bis Mitternacht gemerkt.

## Plan

### 1. Shared-IP-Throttle-Erkennung im Forecast-Pfad nachrüsten

**Datei:** `src/server/forecast.functions.ts`

- In `fetchOpenMeteoOptional` (Z. 901–949) die TTL-Berechnung bei `RATE_LIMIT_DAILY` anpassen: vor dem Schreiben des Markers `openmeteo_usage.total` für den heutigen UTC-Tag laden.
- Wenn `total < 500` → Marker nur **45 min** statt bis Mitternacht setzen, mit `code: "RATE_LIMIT_HOURLY"` im Payload (für Transparenz im Admin-Panel) und einer Warn-Log-Zeile analog zur Druckkarte: „daily 429 mit niedriger Eigen-Nutzung → shared-IP throttle, kurzer Marker bis …".
- Heuristik als kleine lokale Helper-Funktion `isLikelySharedIpThrottle()` direkt neben `nextUtcMidnightIso` definieren — kein Refactor, keine geteilte Datei.

### 2. Akute Markers sofort löschen (User-Action)

Damit der heutige Bericht sofort wieder Mittel-/Langfrist liefert:
- Im Admin-Settings-Screen existiert bereits ein Button **„Open-Meteo Rate-Limits löschen"** (ruft `clearOpenMeteoRateLimits` aus `src/lib/admin-stats.functions.ts`). Diesen einmal klicken — er entfernt alle drei aktiven Marker.
- Alternativ erledigt die neue Heuristik die Sache beim **nächsten** Shared-IP-Throttle automatisch innerhalb von 45 min.

### Was sich **nicht** ändert

- Echte Daily-429s bei eigener Nutzung ≥ 500 Calls bleiben bis 00:00 UTC blockiert (korrekt).
- `pressure-map.server.ts` ist unverändert (hat die Logik schon).
- Keine DB-Migration, keine neuen Secrets, keine Frontend-Änderung.

### Erwartetes Ergebnis

Beim nächsten Shared-IP-Throttle wird der Forecast für maximal 45 min eingeschränkt statt bis 2 Uhr nachts. Heute behebt der „Rate-Limits löschen"-Button das Problem manuell.