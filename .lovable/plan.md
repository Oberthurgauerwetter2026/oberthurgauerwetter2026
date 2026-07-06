## Ziel
Die Folgetag-Druckkarte soll ohne manuellen "Run workflow"-Klick zuverlässig entstehen.

## Beobachtung aus dem Screenshot
- Scheduled Runs funktionieren grundsätzlich (Run #114 lief automatisch am 5. Juli 20:14).
- Trotzdem berichtest du, dass die Karte oft nur nach manuellem Trigger aktuell ist — d. h. der einzelne 17:15-UTC-Slot reicht nicht: fällt er aus (Runner-Queue, DNS, ICON-12Z noch nicht bereit), gibt es keinen Retry.

## Änderung
Nur `.github/workflows/pressure-map.yml` anpassen.

Neuer Zeitplan (UTC, Folgetag-Karte aus 12Z-Modelllauf, verfügbar ~16 UTC):
```
- cron: "15 16 * * *"   # erster Versuch nach 12Z-ICON
- cron: "15 18 * * *"   # Nachfassen (skip, wenn 16:15 OK war)
- cron: "15 20 * * *"   # später Abend
- cron: "15 5  * * *"   # Morgen-Sicherheitsnetz für den laufenden Tag
```
Zusätzlich:
- `nick-fields/retry@v3` um `node generate.mjs` (max 2 Versuche, 60 s Pause) — gleiche Absicherung wie im `openmeteo-ingest`-Workflow.
- `workflow_dispatch` bleibt für manuelle Force-Regenerate-Läufe erhalten.

Der Skip-Check in `generate.mjs` (Zeile 486 ff.) beendet Folge-Slots in Sekunden, sobald `OK · target YYYY-MM-DD` gesetzt ist — keine Zusatzkosten bei Open-Meteo.

## Nicht-Ziele
- Keine Änderung an `generate.mjs`, `pressure-map.server.ts`, Frontend oder Secrets.
