## Änderung

Nur **ein** `pg_cron`-Job behalten:

| Job | UTC-Zeit | Zweck |
|---|---|---|
| `pressure-map-daily` | 13:30 | Tägliche Aktualisierung nach 12-UTC-DWD-Lauf |

Der Backup-Job `pressure-map-backup` (06:00 UTC) wird per `cron.unschedule('pressure-map-backup')` entfernt.

## Was bleibt

- Endpoint, SVG-Renderer, Storage, manueller Button — unverändert.
- `pressure-map-daily` läuft weiter wie bisher.
