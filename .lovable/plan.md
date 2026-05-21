# Bodendruckkarte: zuverlässigere automatische Generierung

## Befund

Der GitHub-Workflow funktioniert **grundsätzlich** — der Lauf von heute 14:31 UTC hat die Karte für 2026-05-22 erfolgreich erzeugt (Status `OK · external-gen · icon_seamless`). Aber der geplante Cron um **04:15 UTC** hat heute morgen nicht generiert (Archiv `europe-pressure-2026-05-21.svg` fehlt mit heutigem Datum).

Ursache: GitHub Actions führt Scheduled Workflows auf Free-Plan-Runnern **nicht garantiert pünktlich** aus — bei hoher Last werden Cron-Slots verspätet oder ganz übersprungen, ohne Fehlermeldung. Mit nur **einem** Slot pro Tag ist das fragil.

## Lösung: Mehrere Cron-Slots + Skip-Logik

Statt einem Slot um 04:15 UTC fügen wir **drei Slots** ein. Der Generator hat bereits eine Skip-Logik (`already current for target X`), die verhindert, dass ein bereits aktueller Tag erneut hochgeladen wird — d. h. zusätzliche Slots verursachen praktisch keine Open-Meteo-Quota-Kosten.

Neue Cron-Zeiten (`.github/workflows/pressure-map.yml`):

```text
15 4  * * *    04:15 UTC  (05:15 / 06:15 CH)  — primärer Morgen-Slot
15 7  * * *    07:15 UTC  (08:15 / 09:15 CH)  — Backup falls 04:15 ausfällt
15 17 * * *    17:15 UTC  (18:15 / 19:15 CH)  — Abend-Slot für Folgetag-Karte
```

Begründung:
- 04:15: aktueller Slot, deckt 00Z-Modelllauf ab
- 07:15: fängt verspäteten Cron + 06Z-Modelllauf ab
- 17:15: erzeugt nach 12Z-Modelllauf bereits die Karte für den Folgetag (passend zum abendlichen Wetterbericht)

## Zusätzlich: Sichtbarkeit im Admin-UI

Das Settings-Panel zeigt aktuell `pressure_map_last_run` + `pressure_map_last_status`. Ergänzung: ein **Health-Badge** ("aktuell" / "verspätet > 18 h" / "fehlt") basierend auf Alter des letzten erfolgreichen `OK · external-gen`-Eintrags, damit du auf einen Blick siehst, ob die Automatik läuft.

## Technische Details

**Datei 1: `.github/workflows/pressure-map.yml`**
- `on.schedule` von 1 auf 3 Einträge erweitern
- `concurrency.group: pressure-map` bleibt — verhindert parallele Läufe
- Kein zusätzlicher Quota-Verbrauch dank vorhandener Skip-Logik in `generate.mjs` (vergleicht `targetUtc` mit zuletzt erzeugter Datei)

**Datei 2: `src/components/OpenMeteoUsageCard.tsx` oder dediziertes Pressure-Map-Status-Widget in `src/routes/_app.settings.tsx`**
- Bestehende `getPressureMapStatus`-Server-Function liefert bereits `lastRun` + `lastStatus`
- Frontend-Logik: parse Alter aus `lastRun`, zeige Badge
  - < 18 h und Status beginnt mit `OK`: grünes Badge "aktuell"
  - 18–36 h: gelbes Badge "verzögert"
  - \> 36 h oder Status enthält `Fehler`/`Pausiert`: rotes Badge "Problem"

**Keine DB-Migration nötig.** Keine neuen Secrets nötig.

## Was sich für dich ändert

- Karte wird täglich 3× geprüft/generiert statt 1× → praktisch keine Ausfälle mehr
- Abends erscheint bereits die Folgetag-Karte (für deinen 18 Uhr-Bericht)
- Im Settings siehst du auf einen Blick, ob die Generierung läuft

## Was nicht geändert wird

- In-App-Worker-Route (`/api/public/hooks/generate-pressure-map`) bleibt als Fallback erhalten
- Storage-Pfade, Bucket, Datei-Namen unverändert — Frontend braucht keine Anpassung
- Bestehender pg_cron-Job kann später deaktiviert werden (separater Schritt)
