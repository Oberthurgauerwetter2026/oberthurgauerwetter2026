## Ziel
Die Folgetag-Druckkarte soll ohne manuellen "Run workflow"-Klick zuverlässig entstehen.

## Diagnose
- `.github/workflows/pressure-map.yml` hat bereits einen `schedule: "15 17 * * *"`.
- Trotzdem läuft er offenbar nicht automatisch. Zwei häufige Ursachen bei GitHub-Actions-Cron:
  1. **GitHub deaktiviert scheduled Workflows nach 60 Tagen ohne Repo-Aktivität** — muss dann in `Actions → Enable workflow` reaktiviert werden.
  2. **Einzel-Slot ist fragil**: fällt der 17:15-UTC-Lauf aus (Runner-Queue, DNS-Glitch, ICON-12Z-Run noch nicht verfügbar), gibt es keinen Retry — die Karte fehlt bis zum nächsten manuellen Trigger.
- `generate.mjs` hat einen Skip-Check: sobald für den Zieltag `OK · target YYYY-MM-DD` vermerkt ist, spart der nächste Lauf die Open-Meteo-Calls und beendet sich in Sekunden. Das erlaubt gefahrlos mehrere Cron-Slots pro Tag ohne Zusatzkosten.

## Änderung
Nur eine Datei anpassen: **`.github/workflows/pressure-map.yml`**.

Neuer Zeitplan (alle Zeiten UTC, Folgetag-Karte aus 12Z-Modelllauf, der ~16 UTC verfügbar ist):
```
- cron: "15 16 * * *"   # erster Versuch, kurz nachdem 12Z-ICON verfügbar ist
- cron: "15 18 * * *"   # Nachfassen (Skip, wenn 16:15 schon OK war)
- cron: "15 20 * * *"   # letzter Slot am Abend
- cron: "15 5  * * *"   # Morgen-Sicherheitsnetz für den laufenden Tag
```
Zusätzlich:
- `retry`-Logik pro Slot (max. 2 Versuche, 60 s Pause) analog zum `openmeteo-ingest`-Workflow.
- `workflow_dispatch` bleibt für manuelle Force-Regenerate-Läufe.

Kein Code in `generate.mjs`, `pressure-map.server.ts` oder Frontend nötig — Skip-Check + Storage-Overwrite existieren bereits.

## Nach dem Merge (einmalig durch dich)
1. Im GitHub-Repo unter **Actions** prüfen, dass "Generate pressure map" **aktiv** ist (bei Bedarf grünen Button "Enable workflow" klicken).
2. Nach dem ersten geplanten Slot (nächste 16:15 UTC) im Actions-Tab kontrollieren, dass der Run automatisch startet.

## Nicht-Ziele
- Kein Wechsel der Datenquelle, keine Änderung am Render-Code, keine neuen Secrets.
