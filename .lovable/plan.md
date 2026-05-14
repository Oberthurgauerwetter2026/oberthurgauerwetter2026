## Ziel

Im Block "Niederschlags-Tagesgang" auf der Prognose-Detailseite (`/forecast/...`) werden die vier Tagesabschnitte aktuell mit Klammerzusatz und Stundenbereich angezeigt:

- `Nacht (00–06)`
- `Vormittag (06–12)`
- `Nachmittag (12–18)`
- `Abend (18–24)`

Du möchtest die Uhrzeitangaben weglassen und nur die Tagesabschnitte als Beschriftung sehen.

## Änderung

In `src/server/forecast.functions.ts` (Zeilen 1478–1483) die `label`-Werte des `blocks`-Objekts kürzen:

```text
night     → "Nacht"
morning   → "Vormittag"
afternoon → "Nachmittag"
abend     → "Abend"
```

Diese Labels werden 1:1 in `WeatherDataView.tsx` (`PrecipDistributionBlock`) gerendert – also keine UI-Änderungen nötig, der Rest (Werte, Spitzen-Hinweis, Layout) bleibt identisch.

Die fachliche Logik (Stundenbereiche 0–6, 6–12, 12–18, 18–24) bleibt unverändert; nur die angezeigten Beschriftungen werden bereinigt.

## Nicht im Plan

- Die Anzeige `Xh ≥0.2mm` bleibt (es ist eine Dauer in Stunden, keine Uhrzeit).
- Andere Stellen im Code (z. B. interne Reasons wie "gegen Abend") sind reine Textbausteine ohne Uhrzeit und bleiben unangetastet.
