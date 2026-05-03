## Ziel

Die täglichen Messwerte der MeteoSchweiz-Stationen **Güttingen (GUT, ~440 m, Bodenseeufer)** und **Bischofszell (BIZ, ~506 m, Thurtal)** über das offene Datenportal `data.tg.ch` nutzen, um die modellierten Tmin/Tmax für Nacht und Folgetag zu **kalibrieren**. Beide Stationen liegen im 15-km-Radius um Amriswil und decken zwei wichtige topografische Extreme ab (Seeufer + Talkessel/Senke).

## Wichtige Vorab-Erkenntnis

Die beiden Datasets liefern **Tageswerte mit ~1–2 Tagen Verzug** (gerade getestet: letzter Wert ist der Vortag), nicht eigentliche „Echtzeit". Das ist für unseren Zweck aber genau richtig: wir vergleichen nicht „jetzt", sondern den **gemessenen Vortag** mit dem **modellierten Vortag** (Bias) und korrigieren damit den Vorhersage-Lauf.

Verfügbare Felder pro Tag und Station (Auszug):
- `tre200d0` Tagesmittel 2 m, `tre200dx` Tagesmax, `tre200dn` Tagesmin (2 m)
- `tre005dn` Tagesmin am Boden (5 cm) — bei GUT vorhanden, bei BIZ leer → für GUT als Bodenfrost-Realwert nutzbar
- Wind, Niederschlag, Strahlung etc. (aktuell nicht benötigt)

## Konzept: Bias-Korrektur mit gleitendem Fenster

Pro Station und pro Variable (`tmin`, `tmax`) berechnen wir den **mittleren Modellfehler der letzten 7 Tage** und ziehen ihn von der Modellprognose ab.

```text
bias_tmin(GUT) = mean over last 7 days of (model_tmin_at_GUT - measured_tre200dn_GUT)
corrected_tmin_GUT_tomorrow = model_tmin_at_GUT_tomorrow - bias_tmin(GUT)
```

Analog für BIZ und für `tmax`. Das fängt systematische Modellfehler in der Region (z. B. Open-Meteo unterschätzt nächtliche Auskühlung im Thurtal) automatisch ab — ohne dass wir handgepflegte Korrekturwerte brauchen.

Das vorhandene `topography.tmin_cold` (Senken-Tiefstwert aus dem Höhen-/Klassifikations-Modell) wird zusätzlich mit dem **BIZ-Bias** verrechnet — BIZ liegt selber in einer Talsenke und ist deshalb der beste Realitäts-Anker für Senken-Tmin.

## Datenfluss

```text
data.tg.ch (GUT, BIZ, letzte 8 Tage)
        │
        ▼
fetchStationRecent(station)  ← einmal pro Forecast-Run
        │
        ▼
Open-Meteo Forecast für GUT (47.602, 9.279) und BIZ (47.498, 9.236)
        │
        ▼
computeBias(station)  →  bias_tmin, bias_tmax
        │
        ▼
applyStationBias(day)  →  hängt an day.weather_data.stations:
                          { GUT: { measured_yesterday, bias_tmin, bias_tmax,
                                   corrected_tmin_today, corrected_tmax_today },
                            BIZ: { ... },
                            radius_tmin_corrected, radius_tmax_corrected }
        │
        ▼
KI-Prompt erhält die korrigierten Werte als zusätzliche Referenz neben dem
bestehenden `topography`-Block.
```

## Geänderte Dateien

- `src/server/forecast.functions.ts`
  - Neue Helper: `fetchStationDaily(stationAbbr, days)`, `fetchStationForecastSeries(lat, lon)`, `computeStationBias()`, `applyStationBias(day, biases)`.
  - In den beiden Generierungs-Pfaden (`generateForecast`, `regenerateEntry`) Stations-Bias **einmal vor dem Day-Loop** berechnen und auf jeden Tag anwenden.
  - Prompt-Builder: neuer Block `Stationen (Realdaten letzte 7 Tage)` mit Bias und korrigierten Tmin/Tmax — KI-Anweisung, dass diese Werte gegenüber reinen Modellwerten Vorrang für **Nacht und Folgetag** haben.

- `src/server/forecast.auto.ts`
  - Identische Erweiterung im Cron-/Auto-Pfad (parallele Pflege wie bisher).

- `src/components/WeatherDataView.tsx`
  - Neuer Block **„Stationen (MeteoSchweiz GUT / BIZ)"** mit Tabelle:
    - gemessenes Vortag-Tmin/Tmax pro Station
    - Bias (°C) der letzten 7 Tage
    - korrigiertes Tmin/Tmax für „heute Nacht" und „Folgetag"

- Keine Schema-Änderung nötig. Die Daten landen in `forecast_entries.weather_data` (jsonb) wie schon `topography`.

## Caching & Performance

- Pro Forecast-Generierung **2 Calls** an `data.tg.ch` (je Station, letzte 8 Tage) + **2 zusätzliche Open-Meteo-Calls** (Modell-Serie an exakt GUT und BIZ für Bias-Berechnung). 
- Alles in **`Promise.all`** parallel, addiert <1 s.
- Optional: 1-h-In-Memory-Cache pro Station, da der Tageswert sich innerhalb des Tags nicht ändert.

## KI-Prompt-Erweiterung (Auszug)

Ergänzung in `prompt_temp` / `DEFAULT_TEMP_RULES`:

```text
Wenn das Feld "stations" vorhanden ist, NUTZE die korrigierten Werte
(corrected_tmin_today, corrected_tmax_today) als primären Anker für
Tmin/Tmax. Die rohen Modellwerte gelten nur als Backup.
- GUT (Güttingen, Bodenseeufer) → wärmster, frostärmster Punkt im Radius
- BIZ (Bischofszell, Thurtal-Senke) → kältester Tmin-Anker; bei
  Strahlungsnacht Senken-Tmin = corrected_tmin_today(BIZ).
Wenn corrected_tmin BIZ ≤ 0 → "Frostgefahr in den Senken".
Wenn corrected_tmin BIZ ≤ 4 und > 0 → "Bodenfrostgefahr".
```

Damit löst die Stations-Korrektur den bisher rein modellierten `topography.tmin_cold`-Wert ab, wo BIZ-Realdaten verfügbar sind (Fallback bleibt).

## Edge Cases

- **API down / Lücke in Messreihe**: bei <3 verwertbaren Tagen wird der Bias auf 0 gesetzt → Fallback auf reine Modellwerte. Logs als Warnung.
- **Frische des letzten Werts**: wenn `reference_timestamp` älter als 3 Tage → Bias verwerfen, nur Topographie-Modell nutzen.
- **Vorzeichenprüfung Bias**: |bias| > 6 °C wird auf ±6 °C geclamped, schützt vor Ausreissern.

## Nicht enthalten (bewusst)

- Stündliche Echtzeit-Werte (z. B. SwissMetNet 10-Min-Daten) — auf dem TG-Portal nicht verfügbar; würde einen direkten MeteoSchweiz-STAC-Zugang erfordern. Tageswerte mit Bias-Korrektur sind für Tmin/Tmax-Vorhersagen aber präziser als ein einzelner Echtzeit-Snapshot.
- Persistierung der Bias-Historie in der DB — der gleitende 7-Tage-Bias wird bei jedem Run frisch berechnet (Datenmenge ist trivial).
