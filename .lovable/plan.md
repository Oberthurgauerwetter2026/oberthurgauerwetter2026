## Ziel

Die Druckkarte täglich automatisch generieren — kein manueller Klick mehr nötig.

## Umsetzung

Zwei `pg_cron`-Jobs anlegen, die per `pg_net` den bestehenden Endpoint `/api/public/hooks/generate-pressure-map` aufrufen:

| Job | UTC-Zeit | Zweck |
|---|---|---|
| `pressure-map-daily` | 13:30 | Hauptlauf nach dem 12-UTC-DWD-Modell (~90 min Latenz für ICON-EU) |
| `pressure-map-backup` | 06:00 | Sicherheitslauf, falls 13:30-Job am Vortag ausgefallen ist |

Beide rufen den stabilen Production-URL `https://oberthurgauerwetter2026.lovable.app/api/public/hooks/generate-pressure-map` mit dem Supabase-Anon-Key als `apikey`-Header auf. Body: `{}` (Endpoint liest keine Parameter).

## Voraussetzungen prüfen / aktivieren

- `pg_cron` und `pg_net` Extensions aktivieren, falls nicht vorhanden.

## Bedienung danach

- Aktuelle Jobs ansehen: `SELECT * FROM cron.job;`
- Lauf-Historie: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;`
- Ein-/Ausschalten weiterhin über das Toggle „Bodendruckkarte (Europa)" in den Einstellungen (`pressure_map_enabled` wird vom Endpoint respektiert — falls nicht, ergänze ich das).

## Was nicht geändert wird

- Endpoint-Code, SVG-Renderer, Storage-Pfade bleiben.
- Manueller „Jetzt neu erzeugen"-Button bleibt für Tests.
