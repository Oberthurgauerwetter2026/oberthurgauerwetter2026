## Bodendruckkarte: Nur 1× Lauf am Abend

**Aktuell:** 3 Cron-Slots pro Tag (04:15, 07:15, 17:15 UTC) in `.github/workflows/pressure-map.yml` + ggf. pg_cron-Trigger auf `/api/public/hooks/generate-pressure-map`.

**Änderung:**
1. **`.github/workflows/pressure-map.yml`** — Die beiden Morgen-Slots (`15 4` und `15 7`) entfernen, nur `15 17 * * *` (18:15/19:15 CH, 12Z-Modelllauf) behalten. Kommentar aktualisieren.
2. **pg_cron prüfen** — Falls ein zusätzlicher pg_cron-Job auf `generate-pressure-map` existiert (Mehrfach-Trigger), auf einen Abend-Slot reduzieren oder ganz entfernen, damit nicht doppelt generiert wird. Ich schaue per `supabase--read_query` in `cron.job` nach.
3. **Status-UI** — Keine Code-Änderung nötig; der bestehende Hinweis im Settings zeigt weiterhin `pressure_map_last_run`/`last_status`.

**Konsequenz:** Karte wird nur noch abends einmal aktualisiert (Folgetag-Karte aus 12Z-Lauf). Spart Open-Meteo-Calls deutlich. Falls der Slot mal ausfällt, ist die Karte bis zum nächsten Abend veraltet — bei Bedarf manueller Workflow-Dispatch möglich.

Soll ich so umsetzen?
