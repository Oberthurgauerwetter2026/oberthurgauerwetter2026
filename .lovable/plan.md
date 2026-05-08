## Befund Dienstag (12.05.)

`weather_data.precip_distribution` ist im gespeicherten Eintrag **null**, obwohl `precip.avg = 13.6 mm` und Modelle den Schwerpunkt vormittags sehen. Ohne Tagesgang-Anker fällt die KI auf die Tagessumme zurück und schreibt pauschal "zeitweise Regenschauer" — eine Wetterbesserung am Nachmittag wird nicht erkannt, weil die Information schlicht nicht im Prompt ankommt.

Drei zusammenwirkende Ursachen:

1. **Prefix-Bug in `computePrecipDistribution`** (`src/server/forecast.functions.ts:1170 ff.`). Der Sammler iteriert `Object.keys(h)` und nimmt jeden Schlüssel mit `startsWith("precipitation_")` als mm-Array — also auch `precipitation_probability_<model>`. Dadurch landen 0–100-%-Werte in der mm-Summe, die Block-Aggregation wird unbrauchbar bzw. degeneriert in Edge-Cases zu null/0.
2. **Kein Mid-Tier-Fallback für Tag 0/1**. `weatherForHourly` liefert für `dayIndex <= 1` `weather` unverändert. Wenn der Short-Tier (CH-Modelle) leer/limitiert zurückkommt — wie aktuell sichtbar (`models_used` enthält für Tag 0 nur `icon_d2`, kein `meteoswiss_icon_ch1` / `arome`) —, ist `weather.hourly` undefined und `precip_distribution` wird null.
3. **Prompt fordert keine aktive Wetterbesserung**. Die bestehende Regel sagt nur "andere Blöcke *dürfen* als trocken beschrieben werden". Eine asymmetrische Niederschlagsverteilung (vormittags Regen, nachmittags trocken) wird nicht zwingend als Tagesverlauf benannt.

## Änderungen (nur `src/server/forecast.functions.ts`)

### 1. Prefix-Bug fixen
- Helper für die Modellschlüssel-Sammlung: nur Keys akzeptieren, die NICHT `_probability` enthalten und genau dem Schema `<base>_<modelName>` folgen.
- Anwenden auf `computePrecipDistribution` (für `precArrs`) und auf alle weiteren Stellen, die denselben Prefix-Trick nutzen (`buildHourlyProfile`, `aggregateHourlyForDay`, `refineDayFromHour`). Diese Funktionen funktionieren heute teilweise nur "zufällig", weil sie kombinierte Werte mitteln.

### 2. Hourly-Fallback Short → Mid für Tag 0/1
- `weatherForHourly(weather, dayIndex)` so anpassen, dass für `dayIndex <= 1` zuerst `weather.hourly` geprüft wird; ist die Quelle leer (kein `time`-Array oder kein `precipitation*`-Schlüssel), auf `weather.hourly_mid` zurückfallen.
- Damit ist auch bei Short-Tier-Ausfall ein Tagesgang vorhanden (gröber, aber existent).

### 3. Diagnose-Log
- In `formatDayData`: wenn `precip.avg >= 1 mm` aber `precip_distribution === null`, `console.warn` mit `dayIndex`, Datum und Grund (kein hourly / kein precipitation-Key / 0 Blöcke). Hilft, künftige Stille-Bugs früh zu sehen.

### 4. Prompt: Wetterbesserung verbindlich machen
Im Block "=== NIEDERSCHLAGS-TAGESGANG ===" (Zeile ~2235) ergänzen:
- "Wenn `peak_block` = `morning` ODER `night` und sowohl `afternoon` als auch `evening` < 1 mm haben (ggf. zusätzlich `dry_windows` mit `from <= 14`), MUSS der Wetterverlauf-Absatz die Wetterbesserung explizit benennen — z. B. 'am Vormittag noch Regen, am Nachmittag Auflockerungen und teils sonnig', 'Wetterbesserung im Tagesverlauf', 'am Nachmittag und Abend trocken'."
- Analog für `peak_block` = `afternoon`/`evening` mit trockenem Vormittag: "am Vormittag trocken, am Nachmittag/Abend Schauer".
- Neue Pflicht: bei Asymmetrie zwischen Blöcken die Begriffe "im Tagesverlauf", "im weiteren Verlauf" oder "Wetterbesserung" verwenden, statt nur Tagesmittel zu paraphrasieren.

## Was wir nicht anfassen

- UI / `WeatherDataView` bleibt unverändert.
- Bias-Correction, Ensemble, Lightning-Off-Logik unverändert.
- Keine DB-Migration.

## Validierung

1. Forecast `8ddb31cf-…` neu generieren (komplett, nicht nur einzelne Einträge).
2. `weather_data` für Tag 0–4 muss `precip_distribution` mit Blöcken liefern (kein null mehr).
3. Für Dienstag erwartet: `peak_block` ≈ `night`/`morning`, `afternoon`/`evening` < 1 mm.
4. Body-Text soll dann z. B. lauten: "Am Morgen noch zeitweise Regen, im Tagesverlauf Wetterbesserung mit Auflockerungen, am Nachmittag und Abend weitgehend trocken."

## Risiken

- Mid-Tier-Fallback für Tag 0/1 bringt gröbere Auflösung als CH-Modelle — nur wirksam, wenn Short-Tier leer ist.
- Schärfere Prompt-Regel kann selten zu früh "Wetterbesserung" diagnostizieren, wenn `peak_block` knapp über 1 mm liegt; mit der bestehenden Intensitätsregel aber abgesichert.
