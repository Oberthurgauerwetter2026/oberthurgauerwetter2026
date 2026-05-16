# Externer Bodendruckkarten-Generator

Eigenständiger Generator für die Europa-Bodendruckkarte. Läuft als GitHub
Action (Ubuntu-Runner mit eigener IP) statt im Cloudflare Worker der App.
Damit teilen wir uns nicht mehr das Open-Meteo-Tageslimit mit anderen
Lovable-Projekten.

## Was er tut

1. Holt Pressure/T850/Niederschlag-Felder von Open-Meteo (ICON_seamless mit
   Fallback auf ECMWF / GFS).
2. Rendert die SVG (gleicher Look wie die bisherige In-App-Version).
3. Lädt sie als `europe-pressure-latest.svg` (+ Archiv-Kopie) in den
   Supabase-Storage-Bucket `weather-maps`.
4. Aktualisiert `app_settings.pressure_map_last_run` / `_last_status`.

Die App liest die Datei unverändert über die bestehende Storage-URL — keine
Frontend-Änderungen nötig.

## Setup (einmalig)

1. **Projekt auf GitHub bringen** (falls noch nicht): in Lovable
   `Plus → GitHub → Connect project`.
2. **Repository-Secrets** unter `Settings → Secrets and variables → Actions`
   anlegen:
   - `SUPABASE_URL` → `https://kdolnotjbhgjieznmpgf.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` → der Service-Role-Key (in Lovable unter
     Cloud → Backend → API Keys verfügbar).
3. **Workflow aktivieren**: unter `Actions` einmal manuell „Generate pressure
   map → Run workflow" starten. Danach läuft er nach Cron-Plan
   (04:15 / 06:15 / 09:15 / 13:15 / 17:15 UTC).

## Alten pg_cron-Job deaktivieren

Sobald der GitHub-Job zuverlässig läuft, kann der bisherige pg_cron-Job, der
`/api/public/hooks/generate-pressure-map` im Worker aufruft, abgeschaltet
werden:

```sql
select cron.unschedule('<job-name>');
```

(Genauen Namen findest du mit `select * from cron.job;`.)

Die Route + `src/server/pressure-map.server.ts` im App-Code bleiben als
manueller Fallback erhalten.

## Lokal testen

```bash
cd pressure-map-generator
npm install
SUPABASE_URL=https://kdolnotjbhgjieznmpgf.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node generate.mjs
```
