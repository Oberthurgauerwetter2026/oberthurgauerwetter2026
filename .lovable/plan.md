## Problem

Das manuelle "Neu generieren" zeigt die Korrektur nicht, weil dafür `src/server/forecast.functions.ts` zuständig ist — nicht `forecast.auto.ts` (das nur der Cron nutzt). Beide Dateien enthalten Duplikate von `formatEveningNight`, `buildFirstEntryContext` und der Tag-Schleife.

## Umsetzung in `src/server/forecast.functions.ts`

Dieselben drei Änderungen wie in `forecast.auto.ts` übertragen:

1. **`formatEveningNight` (Zeile 1672)**
   - Dritten Parameter `nextDayTminAvg?: number | null` ergänzen.
   - Endstunde des Fensters von **05:00** auf **09:00** verlängern (Zeile 1686), damit das nächtliche Minimum (typisch gegen Sonnenaufgang) im Fenster liegt.
   - Auch `endHour = 5` (Zeile 1800) auf `9` setzen und die Window-Labels entsprechend anpassen (Hinweis "Tiefstwert liegt typischerweise gegen Sonnenaufgang").
   - Im Return (Zeile 1810) `tmin` als Minimum aus `hourlyTemps` UND `nextDayTminAvg` berechnen:
     ```
     tmin: r1(Math.min(...hourlyTemps, ...(nextDayTminAvg != null && Number.isFinite(nextDayTminAvg) ? [nextDayTminAvg] : []))),
     ```

2. **`buildFirstEntryContext` (Zeile 1859)**
   - Vor `formatEveningNight(weather)` das Daily-Tagesminimum für Tag 1 holen:
     `const nextDay = useEvening ? formatDayData(weather, 1) : null;`
     `const nextDayTmin = nextDay?.tmin?.avg ?? null;`
   - Beim Aufruf mitgeben: `formatEveningNight(weather, undefined, nextDayTmin)`.

3. **Tag-1-Schleife im "Neu generieren"-Handler (Zeile 2425 ff.)**
   - Wenn `i === 1` und Abendmodus aktiv (`currentZurichHour() >= 12`):
     - `day.tmin = null` setzen und `tmin_omitted_reason` ergänzen.
     - User-Prompt um Hinweis erweitern: "Erwähne KEINEN Tiefstwert — bereits im Block 'Heute Abend & Nacht' genannt. Schreibe nur den Höchstwert."

## Nicht geändert

- Tage 2–5, Trendblock, System-Prompt.
- `forecast.auto.ts` (bereits umgesetzt).
