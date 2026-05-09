## Ziel

Die Karte soll immer den **Folgetag 12:00 UTC** zeigen (Vorhersage statt aktueller/zurückliegender Tag).

## Änderung

Datei: `src/server/pressure-map.server.ts` — Funktion `pickTargetTime()` (Zeilen 502–509).

Statt heute/gestern wird konsequent **morgen 12:00 UTC** gewählt:

```ts
function pickTargetTime(now = new Date()): string {
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0
  ));
  return tomorrow.toISOString().slice(0, 16);
}
```

## Texte (Settings-Seite)

In `src/routes/_app.settings.tsx` Beschreibung/Alt-Text leicht anpassen, sodass „gültig für 12:00 UTC am Folgetag" klar wird:

- Alt-Text: `"Wettervorhersagekarte Europa Folgetag 12 UTC – Bodendruck, Temperatur 850 hPa und Niederschlag (DWD ICON-EU)"`
- CardDescription: „Tägliche **Vorhersagekarte für den Folgetag** mit Isobaren, Temperatur in 850 hPa und 6 h-Niederschlag, gültig für 12:00 UTC. …"

## Nicht geändert

Open-Meteo-Forecast-Endpoint liefert bereits Vorhersagedaten — keine API-Änderung nötig. Cron-Zeitpunkt, Storage-Pfad (`europe-pressure-latest.svg`) und Embed-URL bleiben gleich.
