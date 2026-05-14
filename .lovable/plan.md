## Ziel

Den ersten Eintrag (Restfenster heute → 05 Uhr Folgetag) robuster machen, indem (1) die Stundenmittelung in `formatEveningNight` Modelle gewichtet statt sie ungewichtet zu mitteln und (2) bei dünner Modellabdeckung pro Stunde ein Tier-Fallback auf Mid-Modelle greift — analog zu `collectModelValuesTiered` für Tagesaggregate.

Beide Hebel betreffen ausschliesslich `src/server/forecast.functions.ts`. Es werden keine neuen Open-Meteo-Calls ausgelöst (Hebel 5 nutzt bestehende Mid-Daten); falls Hebel 5 ohne weitere Calls nicht reicht, wird zusätzlich `hourly=true` für das Mid-Tier aktiviert (siehe Punkt 2c).

## Baustein 1 — Gewichtetes Stundenmittel

In `formatEveningNight` wird `hourAvg(arrs, i)` heute als blankes arithmetisches Mittel berechnet. Ersetzen durch eine gewichtete Variante, die nach Variablengruppe unterscheidet:

- **Temperatur, Bewölkung, Sonne**: `CLOUD_SUN_WEIGHTS` (bereits in Baustein 3 eingeführt) als Basis. Für Temperatur eine eigene Tabelle `TEMP_HOURLY_WEIGHTS` (CH1: 0.30, CH2: 0.25, AROME HD: 0.20, ICON-D2: 0.15, ARPEGE: 0.10).
- **Niederschlag**: `PRECIP_HOURLY_WEIGHTS` (CH1: 0.30, AROME HD: 0.25, CH2: 0.20, ICON-D2: 0.15, ARPEGE: 0.10) — AROME bekommt mehr Gewicht, weil konvektionsstark.
- **Wind / Windrichtung**: bleibt wie heute (`WIND_WEIGHTS` + `weightedWindAvg` / `weightedCircularMeanDeg`).
- **Horizont-Modifier**: `horizonForHour(t)` wird pro Stunde aufgerufen und multipliziert das Basisgewicht (z. B. ECMWF/GFS bleiben in `h0_12`/`h12_24` = 0, falls sie über das Mid-Fallback reinkommen).

Fallback-Regel: wenn für eine Stunde kein Modell aus der Gewichtstabelle vorhanden ist, ungewichtetes Mittel über die verfügbaren Modelle (heutiges Verhalten) — keine Regression.

Anwendung in `formatEveningNight`:
- `hourlyTemps`, `hourlyPrecs`, `hourlyClouds`, `hourlySuns` nutzen die neue gewichtete Funktion.
- `summarizeModel` und das `by_model`-Objekt bleiben unverändert (das ist Pro-Modell-Reporting, kein Mittel).

## Baustein 5 — Tier-Fallback im Stundenfenster

Heute: `weather.hourly = shortData?.hourly`. Wenn das Short-Tier ein Rate-Limit hatte oder ICON-CH1/CH2 im Run-Übergang Lücken haben, fällt das gesamte Stundenfenster aus.

Änderung in `formatEveningNight`:
1. **Pro-Stunde-Coverage prüfen**: Für jede Stunde im Slice zählen, wie viele Modelle einen finiten Wert für `temperature_2m` liefern.
2. **Trigger**: Wenn für ≥ 30 % der Stunden im Fenster die Coverage < 2 Modelle ist ODER `weather.hourly?.time` komplett fehlt → Mid-Tier-Hourly nachziehen.
3. **Mid-Tier-Hourly bereitstellen** (siehe 2c): Aktuell ruft `fetchWeather` für Mid `fetchOpenMeteoOptional(..., includeHourly=false)` auf — das wird auf `true` umgestellt, aber **nur für die Variablen, die das Stundenfenster braucht** (Subset von `HOURLY_VARS` ohne Strahlungs-/Schicht-Extras, um Antwortgrösse zu begrenzen). Cache-Key bleibt gleich (Mid wird bis 00 UTC gecacht), Mehrkosten = einmalig pro Tag pro Standort.
4. **Merge**: Aus `midData?.hourly` werden die im Slice fehlenden Stunden ergänzt — Modelle aus `HOURLY_LONGRANGE_BLOCKLIST` (gfs_global, gfs_seamless, ecmwf_ifs025) bleiben ausgeschlossen. Effektiv kommen so `arpege_europe` (und ggf. `icon_eu`, falls in mid) dazu.
5. **Markierung**: Eine neue `degraded_hourly?: { reason: "short_tier_thin" | "short_tier_unavailable"; filled_from: "mid" }`-Eigenschaft im `formatEveningNight`-Rückgabewert, damit das später ggf. im UI angezeigt werden kann (zunächst nur intern geloggt, kein UI-Change).

Bei totalem Ausfall (auch Mid leer) bleibt das heutige Verhalten: `null` zurückgeben, Erst-Eintrag fällt auf Tag-0-Aggregat zurück.

## Reihenfolge

1. Baustein 1 isoliert umsetzen und gegen `withTopo(0)`-Fallback testen (Tagesaggregat darf nicht regressieren).
2. Baustein 5 nachziehen, beginnend mit Coverage-Detection + Logging (ohne Mid-Hourly-Fetch). Erst wenn Logs zeigen, dass Coverage tatsächlich oft dünn ist, Mid-Hourly-Fetch aktivieren.
3. Typecheck. Kein UI-Change, keine Schema-Änderung, keine neue DB-Tabelle.

## Technische Details

- Neue Konstanten am bestehenden Block der Gewichtstabellen (Nähe `WIND_WEIGHTS` / `CLOUD_SUN_WEIGHTS`).
- Neue Hilfsfunktion `weightedHourValue(arrs, i, weights, opts?)` in der Nähe von `hourAvg`. Signatur ähnlich `weightedCloudSunAvg`, aber für ein einzelnes `i`.
- `fetchWeather`-Signatur unverändert; nur das interne `includeHourly`-Flag für Mid wird auf `true` gesetzt, sobald Baustein 5 scharfgeschaltet ist.
- Open-Meteo-Quota: Mid-Hourly erhöht die Antwort um ~Faktor 3 für den Mid-Call. Da Mid bis 00 UTC gecacht ist, bleibt es bei einem Call/Tag/Standort.
- Keine Änderungen an `HORIZON_WEIGHTS`, `REGIME_WEIGHTS`, `pickBestSource` oder `formatDayData`.

## Nicht im Scope

- Hebel 2 (zusätzlicher Mid-Tier-Hourly-Anker mit eigenem Gewicht) — wird durch Baustein 5 teilweise mitabgedeckt; falls später nötig, separat planen.
- Hebel 3 (`models_shortterm` per Default um `arpege_europe` erweitern).
- Hebel 4 (`horizonForHour` in Tagesaggregaten) — Tagesaggregate sind nicht das Problem.
- MOSMIX-Stundendaten — separater Plan.
- UI-Anzeige für `degraded_hourly` — vorerst nur Logging.
