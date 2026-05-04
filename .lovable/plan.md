## Ziel

Der Tiefstwert, der bisher für "Morgen, Dienstag" berechnet wird (Tagesminimum aus den Open-Meteo-Daily-Daten von Tag 1), soll im Block "Heute Abend & Nacht" als Tiefstwert erscheinen — denn dieses Tagesminimum entsteht typischerweise in der Nacht/am frühen Morgen, also genau in dem Zeitfenster, das der Abendblock abdeckt.

Im Block "Morgen, Dienstag" bleibt der Tiefstwert weiterhin weggelassen (bereits umgesetzt).

## Problem aktuell

- "Heute Abend & Nacht" berechnet `tmin` aus den **stündlichen** Temperaturen im Fenster (heute startHour → morgen 09:00). Das ergibt z. B. 14 °C.
- "Morgen, Dienstag" hatte (aus den Open-Meteo-Daily-Daten) `tmin = 9 °C` — was eigentlich das nächtliche Minimum darstellt.
- Beide Werte sind inkonsistent. Der korrekte nächtliche Tiefstwert (9 °C) muss in den Abendblock.

## Umsetzung in `src/server/forecast.auto.ts`

1. **`formatEveningNight` erweitern**
   - Neuen Parameter `nextDayTminAvg: number | null` hinzufügen.
   - Beim Berechnen von `tmin` (aktuell Zeile 421: `tmin: r1(Math.min(...hourlyTemps))`) das Minimum aus *beiden* Quellen nehmen:
     ```
     tmin: r1(Math.min(...hourlyTemps, ...(nextDayTminAvg != null ? [nextDayTminAvg] : [])))
     ```
   - Damit fließt das Daily-Tagesminimum von Tag 1 mit in den Tiefstwert ein.

2. **`buildFirstEntryContext` anpassen**
   - Vor dem Aufruf von `formatEveningNight(weather)` das Tag-1-Objekt holen (`formatDayData(weather, 1)`) und dessen `tmin?.avg` als zweiten Parameter übergeben.
   - Damit nutzt der Abendblock dasselbe nächtliche Minimum, das vorher im "Morgen"-Block erschien.

3. **Keine Änderung** an:
   - `runAutoForecast` (Tag-1-`tmin = null` bleibt wie umgesetzt).
   - `forecast.functions.ts` (System-Prompt unverändert).
   - Tagen 2–5 und Trendblock.

## Erwartetes Ergebnis

- "Heute Abend & Nacht": Tiefstwert ≈ 9 °C (statt 14 °C).
- "Morgen, Dienstag 05. Mai": kein Tiefstwert genannt, nur Höchstwert.
- Konsistenter, einmalig genannter Nacht-Tiefstwert.
