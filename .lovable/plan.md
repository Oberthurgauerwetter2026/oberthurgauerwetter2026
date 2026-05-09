## Ziel

Beim Wind (Geschwindigkeit + Richtung) sollen die vier hochauflösenden Modelle nicht mehr gleichgewichtet, sondern nach Zuverlässigkeit für den Oberthurgau gewichtet kombiniert werden:

| Modell (Open-Meteo-Key)              | Gewicht |
|--------------------------------------|---------|
| `meteoswiss_icon_ch1`                | 0.40    |
| `meteoswiss_icon_ch2`                | 0.30    |
| `meteofrance_arome_france_hd`        | 0.20    |
| `arpege_europe`                      | 0.10    |

Andere Modelle (z. B. `icon_d2`, `gfs_global`, `ecmwf_ifs025`) fliessen **nicht** in den Wind ein. Für Temperatur, Niederschlag etc. bleibt die bestehende Mittelung unverändert.

## Fallback

- Fehlt eines der vier Modelle (z. B. AROME nur 2 Tage, CH1 nur ~33 h), werden die **vorhandenen** Gewichte renormalisiert (Summe wieder = 1).
- Ist **keines** der vier Modelle für den Tag/Stunde verfügbar → Rückfall auf das bisherige ungewichtete Mittel über alle Tier-Modelle (heutiges Verhalten).

## Änderungen

### 1. `src/server/forecast.auto.ts`

Neue Helper am Dateianfang (bei den Wind-Helpern, ~Z. 40):

```ts
const WIND_WEIGHTS: Record<string, number> = {
  meteoswiss_icon_ch1: 0.40,
  meteoswiss_icon_ch2: 0.30,
  meteofrance_arome_france_hd: 0.20,
  arpege_europe: 0.10,
};

function weightedWind(perModel: Record<string, number>) {
  const entries = Object.entries(perModel).filter(([k]) => k in WIND_WEIGHTS);
  if (entries.length === 0) return null; // → Caller fällt auf aggregate() zurück
  const totalW = entries.reduce((s, [k]) => s + WIND_WEIGHTS[k], 0);
  const avg = entries.reduce((s, [k, v]) => s + v * (WIND_WEIGHTS[k] / totalW), 0);
  const vals = entries.map(([, v]) => v);
  return {
    avg: Math.round(avg * 10) / 10,
    min: Math.min(...vals),
    max: Math.max(...vals),
    spread: vals.length < 2 ? 0 : Math.round((Math.max(...vals) - Math.min(...vals)) * 10) / 10,
    by_model: Object.fromEntries(entries),
    weights_used: Object.fromEntries(entries.map(([k]) => [k, WIND_WEIGHTS[k] / totalW])),
  };
}

// zirkulärer gewichteter Mittelwert (für Richtung)
function weightedCircularMeanDeg(perModel: Record<string, number>): number | null {
  const entries = Object.entries(perModel).filter(([k]) => k in WIND_WEIGHTS);
  if (entries.length === 0) return null;
  const totalW = entries.reduce((s, [k]) => s + WIND_WEIGHTS[k], 0);
  let x = 0, y = 0;
  for (const [k, deg] of entries) {
    const w = WIND_WEIGHTS[k] / totalW;
    const r = (deg * Math.PI) / 180;
    x += w * Math.cos(r); y += w * Math.sin(r);
  }
  if (x === 0 && y === 0) return null;
  let d = (Math.atan2(y, x) * 180) / Math.PI;
  if (d < 0) d += 360;
  return Math.round(d);
}
```

#### a) Tageswerte — `formatDayData` (~Z. 237–242)

```ts
const windPerModel = collectModelValuesTiered(weather, "windspeed_10m_max", dayIndex);
const wind_max = weightedWind(windPerModel) ?? aggregate(windPerModel);

const windDirPerModel = collectModelValuesTiered(weather, "winddirection_10m_dominant", dayIndex);
const wind_dir = aggregate(windDirPerModel); // unverändert (für by_model/spread Anzeige)
const wind_dir_avg =
  weightedCircularMeanDeg(windDirPerModel) ??
  circularMeanDeg(Object.values(windDirPerModel));
const wind_dir_compass = wind_dir_avg != null ? compassToName(wind_dir_avg) : null;
const wind_label = buildWindLabel(wind_dir_avg, wind_max?.avg ?? null);
```

#### b) Stunden-/Zeitfenster (~Z. 322–408)

Die Funktion `hourAvg` mittelt aktuell stündlich gleichgewichtet über alle Modelle. Stattdessen pro Stunde:

```ts
function hourWeightedWind(arrs: Record<string, number[]>, i: number): number | null {
  const per: Record<string, number> = {};
  for (const [m, arr] of Object.entries(arrs)) {
    const v = arr?.[i];
    if (v != null && Number.isFinite(v) && m in WIND_WEIGHTS) per[m] = v;
  }
  const w = weightedWind(per);
  if (w) return w.avg;
  // Fallback: ungewichtetes Mittel über alle vorhandenen Modelle
  return hourAvg(arrs, i);
}
```

Im Fenster-Code (~Z. 368, 399–408):
- `hourlyWinds` über `hourWeightedWind(wArrs, i)` statt `hourAvg(wArrs, i)`.
- `windDirSamples` nur aus den vier WIND_WEIGHTS-Modellen sammeln und am Ende `weightedCircularMeanDeg` über das Stundenmittel verwenden (alternativ: pro Stunde gewichtetes Richtungsmittel berechnen, dann zirkulär über die Stunden mitteln — bevorzugt, sauberer).
- `wind_max` im Fenster bleibt das **Maximum** dieser stündlich gewichteten Werte.

### 2. `src/server/forecast.functions.ts`

Spiegelt die gleiche Logik (gleiche Aggregations-Helfer existieren dort, vgl. Z. 234, 288). Identische `WIND_WEIGHTS` + `weightedWind` + `weightedCircularMeanDeg` einführen und die Tages-/Stunden-Wind-Aggregationen analog umstellen, damit beide Pfade (manuelle Forecast-Generation und Auto-Generation) konsistent sind.

### 3. Transparenz im Output

`wind_max` (und falls sinnvoll `wind_dir`) erhalten zusätzlich `weights_used`, sodass im Prompt/Log nachvollziehbar ist, welche Modelle mit welchem Anteil eingeflossen sind. Keine UI-Änderung nötig — die Settings-/Forecast-Ansicht zeigt weiterhin `avg`/`min`/`max`/`by_model`.

## Nicht geändert

- Modell-Listen (`shortModels`/`midModels`/`longModels`), Tier-Auswahl, Caching, Bias-Correction.
- Aggregation für Temperatur, Niederschlag, Bewölkung, Sonnenscheindauer, Weathercode.
- MOSMIX-Pfad (`mosmix.server.ts`) — dort gibt es kein Multi-Modell-Wind, sondern Stations-Maxima.
