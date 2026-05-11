## Ziel

Die Bodendruckkarte soll **genau einmal pro Tag** für den Folgetag (12:00 UTC) erzeugt werden — täglich um **04:30 UTC**, mit Schutz gegen versehentliche Doppel-Läufe (manueller Button + Cron + Remix-Reste).

## Änderungen

### 1. Cron-Job auf 04:30 UTC fixieren (Supabase, via SQL-Insert)

- Bestehende `pg_cron`-Jobs auflisten und alle alten/zusätzlichen Pressure-Map-Schedules entfernen (`cron.unschedule(...)`).
- Neuen Job anlegen:
  - Name: `pressure-map-daily-0430`
  - Schedule: `30 4 * * *`
  - Body: `{}`
  - URL: `https://project--e38eb7cd-9a65-493a-b3eb-f8b0eb5a851d.lovable.app/api/public/hooks/generate-pressure-map`
  - Header: `apikey: <anon-key>` (vom Hook bereits geprüft)

Wird per Supabase-Insert-Tool ausgeführt (nicht als Migration, da keine Strukturänderung).

### 2. Server-seitige Idempotenz in `generatePressureMap()`

In `src/server/pressure-map.server.ts`:
- Vor `fetchGrids()` `app_settings.pressure_map_last_status` lesen.
- Wenn Status mit `OK` beginnt **und** den heutigen Ziel-Tag (`pickTargetTime().slice(0,10)`) enthält → früh zurückkehren mit `{ skipped: true, targetUtc, bytes: 0 }` statt erneut zu rendern.
- Verhindert Doppel-Läufe bei: manueller Button-Klick nach Cron, Cron + alter Schedule, versehentlich erneuter Aufruf.

### 3. Hook-Route Rückgabe anpassen

In `src/routes/api/public/hooks/generate-pressure-map.ts`:
- Wenn `result.skipped === true` → Status `"Skip (cron) · bereits aktuell für ${targetUtc}"` schreiben statt „OK (cron)".
- Gleiche Logik in `src/lib/pressure-map.functions.ts` (`triggerPressureMap`) für den manuellen Button.

### 4. UI-Hinweis (optional, klein)

In `src/routes/_app.settings.tsx` neben dem „Druckkarte jetzt aktualisieren"-Button kurzer Hinweistext: *„Cron-Lauf täglich um 04:30 UTC für den Folgetag · manuelle Auslösung überspringt, wenn bereits aktuell."*

## Außerhalb des Umfangs

- Keine Änderung an der Karten-Rendering-Logik selbst.
- Keine Änderung am 429-Handling (wurde bereits separat erledigt).
- Keine Änderung am Ziel-Zeitpunkt (bleibt morgen 12:00 UTC).
