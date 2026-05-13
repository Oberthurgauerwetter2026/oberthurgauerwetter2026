## Ziel

1. **Sofort:** Drei stale `om:ratelimit:*`-Marker in `weather_cache` löschen → Forecast-Generierung läuft heute wieder mit allen drei Modellsets (Kurz-/Mittel-/Langfrist + Trend Tag 6–10).
2. **Strukturell:** Admin-Button „Rate-Limit zurücksetzen" in den Settings, damit du das in Zukunft jederzeit selbst kannst.

## Änderungen

### 1. Marker sofort löschen (über Insert-Tool)

```sql
DELETE FROM weather_cache WHERE cache_key LIKE 'om:ratelimit:%';
```

Betrifft genau die drei aktiven Marker (`meteoswiss_icon_ch1,...`, `meteoswiss_icon_ch2,arpege_europe`, `ecmwf_ifs025,gfs_global,icon_eu`). Forecast verwendet sofort wieder Open-Meteo.

### 2. Server-Function `clearOpenMeteoRateLimits` hinzufügen

Neu in `src/lib/admin-stats.functions.ts`:
- `createServerFn({ method: "POST" })` mit `requireSupabaseAuth`-Middleware.
- Admin-Check (gleiches Muster wie `getOpenMeteoUsage`).
- `DELETE FROM weather_cache WHERE cache_key LIKE 'om:ratelimit:%'` via `supabaseAdmin`.
- Liefert `{ cleared: number }` zurück.

### 3. UI-Button in `OpenMeteoUsageCard`

In `src/components/OpenMeteoUsageCard.tsx`:
- Button „Rate-Limit zurücksetzen" — nur sichtbar/aktiv, wenn `isRateLimited === true` oder mind. ein Marker existiert.
- Klick → `clearOpenMeteoRateLimits()` aufrufen → Toast „N Marker gelöscht" → Card neu laden.
- Loading-State mit `Loader2`-Spinner.

## Was bleibt unverändert

- TTL-Logik für DAILY/HOURLY/MINUTELY-Marker bleibt wie sie ist (24h / 30 min / 2 min).
- `forecast.functions.ts` wird nicht angefasst.
- Druckkarten-Cron (1×/Tag um 06:00 UTC) bleibt.
- Kein neues DB-Schema.

## Erwartetes Ergebnis

- **Heute:** Forecast funktioniert in der nächsten Generierung wieder vollständig (alle drei Modellsets verfügbar, Trend Tag 6–10 erscheint wieder).
- **Künftig:** Falls erneut ein DAILY-Marker fälschlich gesetzt wird, kannst du in den Settings auf einen Button klicken und musst nicht bis 00:00 UTC warten.
- Eingeschränkter Modus erscheint nur noch, wenn das Limit wirklich erreicht ist.
