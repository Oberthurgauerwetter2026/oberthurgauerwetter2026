## Horizont-basierte Modell-Gewichtung

Aktuell werden alle Modelle pro Tag mit dem gleichen Regime-Gewicht gemittelt — unabhängig davon, wie weit in der Zukunft der Tag liegt. Du willst die Gewichte zusätzlich nach **Vorhersage-Horizont** staffeln, sodass kurzfristig die hochaufgelösten regionalen Modelle dominieren und globale Modelle erst im Mittel-/Langfristbereich beitragen.

### Ziel-Matrix (multiplikativ über das Regime-Gewicht)

| Horizont (Stunden ab jetzt) | ICON-CH1 | ICON-CH2 | ARPEGE | AROME-HD | ECMWF | GFS | Externe Quelle |
|---|---|---|---|---|---|---|---|
| **0–12 h** (Heute morgen/mittag) | 1.6 | 1.4 | 1.2 | 1.0 | 0.0 | 0.0 | Radar + SMN-Stationen (bereits aktiv) |
| **12–24 h** (Heute spät / Nacht) | 1.5 | 1.3 | 1.2 | 0.9 | 0.0 | 0.0 | Stations-Bias (bereits aktiv), Temp-Trend-Korrektur |
| **24–48 h** (Tag +1) | 1.3 | 1.2 | 1.2 | 0.8 | 0.6 | 0.4 | — |
| **>48 h** (Tag +2 …) | 1.0 | 1.0 | 1.1 | 0.6 | 1.0 | 0.7 | — |

Gewicht `0.0` = Modell trägt nichts zum Aggregat bei. Werte sind multiplikativ mit `REGIME_WEIGHTS` (z. B. konvektiver Tag in 0–12 h: ICON-CH1 = 1.6 × 1.6 = 2.56).

### Umsetzung in `src/server/forecast.functions.ts`

1. **Neuer Typ + Konstante**
   ```ts
   type Horizon = "h0_12" | "h12_24" | "h24_48" | "h48_plus";
   const HORIZON_WEIGHTS: Record<Horizon, Record<ModelKey, number>> = { ... };
   ```

2. **Helper `horizonForDay(weather, dayIndex): Horizon`**
   - Liest `weather.daily.time[dayIndex]` (ISO-Datum) und vergleicht mit `now()`.
   - Gibt den Bucket basierend auf Stunden-Differenz vom Tagesmittelpunkt (12:00 lokal) zurück.
   - Tag 0 vor 12 Uhr → `h0_12`, Tag 0 nach 12 Uhr → `h12_24`, Tag 1 → `h24_48`, sonst `h48_plus`.

3. **Helper `horizonForHour(weather, hourIso): Horizon`**
   - Für stündliche Aggregate (CAPE, Gusts, Dewpoint), damit Tag 0 morgens und Tag 0 abends korrekt unterschiedliche Buckets bekommen.

4. **`regimeWeight()` erweitern → `combinedWeight(name, opts)`**
   ```ts
   combinedWeight(name, { variable, regime, horizon })
     = REGIME_WEIGHTS[regime][k] * VAR_MODIFIERS[var][k] * HORIZON_WEIGHTS[horizon][k]
   ```
   Wenn `horizon`-Gewicht `0` ist, wird das Modell aus der Aggregation komplett ausgeschlossen (auch aus `min/max/spread/p10/p90` über einen `effectiveModels`-Filter — sonst verzerrt z. B. ECMWF Tag 0 die Bandbreite).

5. **`aggregate(perModel, opts)` anpassen**
   - Akzeptiert `horizon` zusätzlich zu `variable`/`regime`.
   - Filtert Modelle mit Gewicht `0` vor der Statistik raus.
   - `by_model` zeigt weiterhin alle Roh-Werte (Transparenz im Debug).

6. **Aufrufer aktualisieren**
   - `formatDayData(weather, dayIndex)`: berechnet `regime` (wie bisher) **und** `horizon = horizonForDay(...)`, übergibt beides an `aggregate()`.
   - Stündliche Aggregate (CAPE, Gusts, Föhn-Indikatoren): `horizonForHour(...)` pro Stunde.
   - `out.regime` bleibt; zusätzlich `out.horizon` ins Debug-Output, damit es in `WeatherDataView` sichtbar wird.

### Was bleibt unverändert

- **Tier-Auswahl** (`models_shortterm` / `_midterm` / `_longterm` aus `app_settings`) — die schaltet weiterhin grob, welche Modelle überhaupt abgefragt werden. Die Horizont-Gewichte feinjustieren danach.
- **Radar-Korrektur** (`radar.server.ts`), **SMN-Stationsdaten** (`swissmetnet.server.ts`) und **Bias-Korrektur** (`bias-correction.server.ts`) sind bereits horizont-spezifisch (Radar: 0–6h, Bias: T+0/T+1). Keine Änderung nötig — nur in der Plan-Tabelle erwähnt, damit der Gesamtfluss klar ist.
- **Temperaturtrend-Korrektur Tag 0/1**: ist über `bias_per_hour_enabled` + `night_clear_cooling_c` bereits abgedeckt. Falls du eine zusätzliche Tmin/Tmax-Plausibilitätsprüfung willst (z. B. Tmin nicht über Tagestiefstwert der letzten Station-Stunde), kann das als separater Schritt rein — sag Bescheid.

### Validierung

- `weather_data.debug.horizon` pro Tag sichtbar im `WeatherDataView`.
- Tag 0: `by_model` enthält ECMWF/GFS-Werte, aber `avg` ignoriert sie (manuell nachrechnen).
- Tag 3: ECMWF/GFS tragen wieder ~ wie ICON.
- A/B über bestehenden Schalter `regime_weighting_enabled` (deckt jetzt auch Horizont-Gewichtung ab — oder neuer Schalter `horizon_weighting_enabled`, falls du sie getrennt schalten willst).

### Risiken

- Tag 0 ohne ECMWF/GFS → kleinere Modell-Stichprobe → enger Spread, der Konfidenz vortäuscht. Mitigation: `spread`-basierte Unsicherheits-Klassifikation (`classifyUncertainty`) bleibt; zusätzlich Hinweis im Debug, wieviele Modelle effektiv beigetragen haben (`n_effective`).
- Falls ICON-CH1/CH2 für einen Tag 0 ausfallen (Open-Meteo-Lücke), bleibt nur ARPEGE → Aggregat = ARPEGE. Akzeptabel, aber im Debug sichtbar machen.
