## Ziel

Niederschlag, Niederschlagswahrscheinlichkeit, Bewölkung und Sonnenscheindauer sollen — analog zum Wind — aus den hochauflösenden Modellen **gewichtet** kombiniert werden, mit MeteoSwiss-Schwerpunkt. Globale Modelle (ECMWF/GFS/ICON-D2) dürfen nur einspringen, wenn **keines** der vier hochauflösenden Modelle für die Variable Daten liefert.

## Gewichte (für Niederschlag, Prob, Bewölkung, Sonne)

| Modell                          | Gewicht |
|---------------------------------|---------|
| `meteoswiss_icon_ch1`           | 0.45    |
| `meteoswiss_icon_ch2`           | 0.35    |
| `meteofrance_arome_france_hd`   | 0.15    |
| `arpege_europe`                 | 0.05    |

Fehlende Modelle → vorhandene Gewichte werden renormalisiert.

## Beispiel: Dienstag 12. Mai (heute defekt)

- **Niederschlag**: ARPEGE 25.8 mm vs CH2 5.7 mm → bisher 15.2 mm (Mittel). Neu: CH2 (renorm 0.875) + ARPEGE (0.125) → **8.2 mm**.
- **Bewölkung**: CH2 hat keinen Wert → bisher Fallback ARPEGE/ECMWF/GFS = 58 %. Neu: nur ARPEGE (renorm 1.0) = **44 %**. Wenn AROME Daten hat, wird AROME mitgewichtet.
- **Niederschlagswahrscheinlichkeit**: bisher ECMWF/GFS/CH2 = 89 %. Neu: nur CH2 (renorm 1.0) = **81 %**.
- **Sonne**: ARPEGE 11 + CH2 9.6 → bisher 10.4 h. Neu: CH2 (0.875) + ARPEGE (0.125) → **9.8 h**.

## Änderungen im Code

### 1. Fallback-Logik korrigieren — `collectModelValuesTiered`

Aktuell (`forecast.functions.ts` & `forecast.auto.ts`) mischt der Tier-Collector globale Modelle ein, sobald < 2 Modelle Daten liefern. Das ist die Ursache für den ECMWF/GFS-Einfluss auf Niederschlag/Bewölkung an Tag 3.

Neue Variante `collectPriorityModelValues(weather, varName, dayIndex)`:

1. Sammle Werte ausschliesslich aus den vier priorisierten Modellen (`WIND_WEIGHTS`-Keys → für Klarheit umbenennen in `PRIORITY_MODELS`) über alle Tiers (short → mid → long).
2. Wenn **mindestens eines** davon Werte liefert → diese Map zurückgeben.
3. Sonst: Fallback auf die bestehende `collectModelValuesTiered`-Logik (alle Tier-Modelle).

Die alte Funktion bleibt für Variablen, die nicht gewichtet werden (Temperatur, Weathercode), erhalten.

### 2. Gewichteter Aggregator für skalare Variablen

Neuer Helper in beiden Dateien:

```ts
const PRECIP_CLOUD_WEIGHTS: Record<string, number> = {
  meteoswiss_icon_ch1: 0.45,
  meteoswiss_icon_ch2: 0.35,
  meteofrance_arome_france_hd: 0.15,
  arpege_europe: 0.05,
};
function weightedAvg(perModel: Record<string, number>, weights: Record<string, number>) {
  const entries = Object.entries(perModel).filter(([k, v]) => k in weights && Number.isFinite(v));
  if (!entries.length) return null;
  const total = entries.reduce((s, [k]) => s + weights[k], 0);
  if (total <= 0) return null;
  const avg = entries.reduce((s, [k, v]) => s + v * (weights[k] / total), 0);
  const used: Record<string, number> = {};
  for (const [k] of entries) used[k] = Math.round((weights[k] / total) * 100) / 100;
  return { avg: Math.round(avg * 10) / 10, weights_used: used };
}
```

(`weightedWindAvg` wird auf `weightedAvg(perModel, WIND_WEIGHTS)` reduziert — keine Funktionsänderung.)

### 3. Tageswert-Aggregation umstellen

In `formatDayData` (beide Dateien):

```ts
// Niederschlag
const precipPerModel = collectPriorityModelValues(weather, "precipitation_sum", dayIndex);
const precip_raw = aggregate(precipPerModel); // weiterhin avg/min/max/by_model
const wP = weightedAvg(precipPerModel, PRECIP_CLOUD_WEIGHTS);
const precip = precip_raw && wP ? { ...precip_raw, avg: wP.avg, weights_used: wP.weights_used } : precip_raw;

// Analog für: precipitation_probability_max, cloudcover_mean, sunshine_duration
```

Wichtig: `agg(...)`/`aggregate(...)` weiterhin auf den **gleichen** `perModel` aufrufen, damit `p10/p50/p90/spread/by_model` die Streuung der priorisierten Modelle widerspiegeln (sonst wäre die Unsicherheits-Anzeige inkonsistent).

Die abgeleitete Bewölkung-aus-Sonne-Heuristik (`derived_from_sunshine`) bleibt als zweiter Fallback bestehen, nur wenn `cloudcover` ganz fehlt.

### 4. Stunden-/Zeitfenster-Aggregation (`forecast.functions.ts` ~Z. 1952 ff., `forecast.auto.ts` Stunden-Block)

Spiegelbildlich umstellen:
- `precPerModel`, `probPerModel`, `cloudPerModel`, `sunHPerModel` werden bei der Aggregation zusätzlich gewichtet (gleiche Override-Methode wie für Wind).
- Pro Stunde im Window-Build: gewichtetes Modell-Mittel statt `hourAvg`. Fallback wieder auf `hourAvg` (alle Modelle) wenn keines der vier Daten hat.

### 5. Konsequenz fürs Bias-/MOSMIX-Blending

- **Bias-Korrektur** (Stationen) wirkt unverändert auf den neuen `precip.avg` → korrekt.
- **MOSMIX-Blend** (Tag 2/3 25 %, ab Tag 4 45 %) verwendet `omDay.precip` → bekommt jetzt den gewichteten Wert. Keine Codeänderung nötig, aber das senkt für Dienstag den Endwert spürbar (statt Mittelung mit MOSMIX über aufgeblähten OM-Wert).

## Nicht geändert

- **Temperatur**, **Weathercode**, **Wind-Richtung**: bleiben wie heute (Wind hat eigene Gewichtung). Bei Temperatur ist die Modell-Streuung gering und ECMWF/GFS sind hier unkritisch.
- **Modell-Listen** in `app_settings`, Tier-Auswahl, Caching, Radar-Korrektur, Lightning, Bias.
- **MOSMIX-Pfad** (`mosmix.server.ts`), **Pressure-Map**.

## Verifikation nach Implementierung

1. Aktuellen Forecast `72853bed-…` neu generieren.
2. Dienstag-Eintrag prüfen: `precip.avg` sollte ≈ 8 mm, `cloudcover.avg` ≈ 44 %, `precip_prob.avg` ≈ 81 %, `sunshine_h.avg` ≈ 9.8 h zeigen.
3. `weights_used` in den jeweiligen Aggregat-Objekten kontrolliert ausgeben (Log/JSON), um Renormalisierung nachvollziehbar zu machen.
