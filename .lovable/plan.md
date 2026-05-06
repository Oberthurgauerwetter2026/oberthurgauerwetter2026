# Tag-1-Eintrag erst ab 06:00 starten

## Problem

Der Donnerstag-Eintrag enthält die Stunden 00:00–06:00, die schon im „Heute Abend & Nacht"-Eintrag stehen. Folge: doppelte Beschreibung („In der Nacht zeitweise Regen" taucht in beiden Einträgen auf).

## Lösung

Tag-1-Aggregate (Open-Meteo + MOSMIX) und der `precip_distribution`-Block werden nur über die Stunden **06:00–24:00** berechnet. Der Tag-1-Eintrag startet damit textlich am Vormittag — keine Überschneidung mit dem Vornacht-Eintrag.

## Was getan wird

### `src/server/forecast.functions.ts`

1. **Neue Helper-Funktion `formatDayDataFromHour(weather, dayIndex, fromHour)`**
   - Baut Tag-Aggregate (tmin, tmax, precip_sum, wind_max, cloudcover, sunshine, precip_prob_max) aus den **stündlichen** Werten ab `fromHour`.
   - Für `dayIndex === 1` mit `fromHour = 6` aufgerufen.
   - Pro-Modell-Werte und `spread` analog zum bestehenden `formatDayData` aufbauen, damit die UI-Modelltabelle gleich aussieht.

2. **`buildDay(dayIndex)` anpassen**
   - Für `dayIndex === 1`: `omDay = formatDayDataFromHour(weather, 1, 6)` statt `formatDayData(weather, 1)`.
   - MOSMIX-Mix bleibt unverändert (MOSMIX liefert Tagesaggregate ohne Stundenraster — wir mischen den Tag-1-Wert wie gehabt; akzeptiertes leichtes Inkonsistenzbudget).
   - Stations-Bias, pressure/snow-line-Regime, Topographie unverändert.

3. **`computePrecipDistribution`**
   - Neuer Parameter `fromHour` (default 0). Für Tag 1 mit 6 aufgerufen → `night`-Block entfällt automatisch (range [0, 6] liegt vor `fromHour`).

4. **Prompt-Hinweis im Donnerstag-Titel-Block**
   - Im Loop für `i === 1` einen kurzen Hinweis im userPrompt: „Dieser Eintrag beschreibt Donnerstag ab 06:00 Uhr. Die Vornacht (00–06) wurde bereits im vorherigen Eintrag behandelt und darf NICHT erwähnt werden."

### `src/components/WeatherDataView.tsx`

- Keine Änderung nötig. Tageswerte werden gleich angezeigt, nur dass tmin/precip jetzt das Fenster 06–24 statt 00–24 widerspiegeln. Optional: kleiner Badge „06–24 Uhr" beim Donnerstag-Eintrag.

## Erwartetes Verhalten

- Donnerstag-Eintrag erwähnt **kein** „in der Nacht" mehr.
- tmin Donnerstag = Tagestiefst Tag (oft 06:00 oder tagsüber bei Föhn), nicht mehr Tiefstwert der Vornacht.
- Niederschlagssumme Donnerstag enthält nicht mehr den frühen Morgenregen, der schon im Abend/Nacht-Eintrag steht.
- Tag 2+ unverändert.
