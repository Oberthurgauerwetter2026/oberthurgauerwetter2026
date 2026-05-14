
## Befund (Freitag-Eintrag, `d4900cba-…`)

Im `weather_data` zeigt sich ein klarer Datenkorruptions-Bug, der Tag 1 (Freitag) und das „Heute Abend & Nacht"-Fenster betrifft:

```
precip.by_model = {
  meteoswiss_icon_ch1: 3,
  meteoswiss_icon_ch2: 5.5,
  meteofrance_arome_france_hd: 0.1,
  icon_d2: 8.6,
  probability_meteoswiss_icon_ch1: 397,   ← MÜLL
  probability_meteoswiss_icon_ch2: 335    ← MÜLL
}
→ precip.avg = 140.9 mm, spread = 396.9 mm
```

```
cloudcover.by_model = {
  icon_d2: 99.9,
  low_icon_d2: 64.5, mid_icon_d2: 99.6, high_icon_d2: 42.3,   ← MÜLL
  low_meteofrance_arome_france_hd: 58.9, …                    ← MÜLL
}
→ cloudcover.weights_used = { icon_d2: 1 }   ← CH1/CH2 fallen raus
```

## Root Cause

In `refineDayFromHour` (Z. 2193), `formatEveningNight` (Z. 2335), `buildHourlyProfile` (Z. 1628) und `computePrecipDistribution` (Z. 1499) sammelt `collectArrs(base)` per **Präfix-Matching** alle Hourly-Keys, die mit `base + "_"` beginnen, und kappt das Präfix als „Modellname":

```ts
if (k.startsWith(base + "_") && Array.isArray(h[k])) out[k.slice(base.length + 1)] = h[k];
```

Open-Meteo Hourly liefert aber:
- `precipitation_meteoswiss_icon_ch1` ✓ ( Modell = `meteoswiss_icon_ch1`)
- `precipitation_probability_meteoswiss_icon_ch1` → wird fälschlich als Modell `probability_meteoswiss_icon_ch1` interpretiert
- `cloudcover_low_icon_d2` → wird fälschlich als Modell `low_icon_d2` interpretiert (analog `mid_*`, `high_*`)

Folge: `perModel(pArrs, "sum")` summiert die Wahrscheinlichkeit (0–100 %) über 24 Stunden zu Werten wie 397 „mm". `aggH("precipitation_sum", precPerModel)` schreibt das in `out.precip`. Damit **überschreibt `refineDayFromHour` die saubere Tageswert-Aggregation aus `formatDayData`** mit korrupten Daten — exakt das, was der Nutzer als „Basis wird immer schlechter" sieht.

Zusätzlich: weil die korrupten Modellnamen nicht in `CLOUD_SUN_WEIGHTS` / `PRECIP_HOURLY_WEIGHTS` stehen, fällt der gewichtete Mittelwert auf den letzten verbliebenen Eintrag (z. B. nur `icon_d2`) zurück — CH1/CH2 sind faktisch ausgeschlossen, obwohl ihre Daten da sind.

## Plan

### Baustein 1 — Strikte Modell-ID-Filterung in `collectArrs` (Hauptfix)

`collectArrs` so umbauen, dass nur Keys mit bekannter Modell-ID akzeptiert werden. Bekannte Modelle = Vereinigung von `weather.modelLists.short/mid/long` (komma-getrennt) plus Sentinel `"default"`.

Akzeptiert: `k === base` (→ `default`) oder `k === ${base}_${model}` für `model ∈ knownModels`. Alles andere wird verworfen.

Damit verschwinden `probability_*`, `low_*`, `mid_*`, `high_*` aus `pArrs`/`cArrs` an allen vier Stellen:
1. `refineDayFromHour` (Z. 2193) — fixt Tag 1 `precip` und `cloudcover` (Hauptursache des Freitag-Problems)
2. `formatEveningNight` (Z. 2335) — fixt „Heute Abend & Nacht"-Eintrag analog
3. `buildHourlyProfile` (Z. 1628) — fixt `hourly_profile.p` (Niederschlagsspur) und Cloud-Schichten
4. `computePrecipDistribution` (Z. 1499) — fixt `precip_distribution.blocks[*].precip_mm` (Tagesgang)

Implementierung: gemeinsamer Helper `makeCollectArrs(weather)` der die `knownModels`-Set einmal aufbaut und eine `collectArrs`-Closure zurückgibt. Die vier Stellen rufen den Helper auf statt eigene Inline-Variante.

Wichtig: `cloudcover_low/mid/high` sollen weiterhin verfügbar sein für `buildHourlyProfile` (`cLowArrs` etc., Z. 1643–1645) — die nutzen aber `collectArrs("cloudcover_low")` mit eigenem Basisnamen, was nach Fix korrekt nur `cloudcover_low_<model>` matcht. Kein Funktionsverlust.

### Baustein 2 — Diagnose-Log nach dem Fix

In `refineDayFromHour` direkt nach `precPerModel` / `cloudPerModel` / `sunHPerModel` einen `console.warn`, wenn nach dem Fix **weniger als 2 Modelle** beitragen oder wenn **kein einziges ICON-Modell** (`meteoswiss_icon_ch1`, `meteoswiss_icon_ch2`, `icon_d2`) drin ist. Kein Verhalten ändern, nur sichtbar machen — damit zukünftige Coverage-Lücken (CH1 expired etc.) im Log auffallen statt still durchzulaufen.

### Verifikation

1. Typecheck (build:dev läuft automatisch).
2. Stichproben-Query nach nächster Forecast-Generierung:
   ```sql
   select jsonb_pretty(weather_data->'precip'->'by_model')
   from forecast_entries
   where forecast_id = '<neuer forecast>' and entry_date = current_date + 1;
   ```
   Erwartung: nur echte Modell-IDs (`meteoswiss_icon_ch1`, `meteoswiss_icon_ch2`, `icon_d2`, `meteofrance_arome_france_hd`), keine `probability_*` / `low_*` / `mid_*` / `high_*`.
3. `cloudcover.weights_used` sollte CH1/CH2/D2 enthalten, nicht nur `icon_d2: 1`.

### Nicht im Scope

- Hebel zur stärkeren ICON-Gewichtung — erst sinnvoll, wenn die Daten überhaupt sauber ankommen.
- Überarbeitung des AI-Prompts — der nachgelagerte Schritt sieht nach dem Fix automatisch konsistente Werte.
- ICON-CH1-Horizont (33 h) für Tag 1 Nachmittag — separates Thema, kein Bug.

## Erwarteter Effekt

Tag 1 (`refineDayFromHour`) und „Heute Abend & Nacht" (`formatEveningNight`) bekommen wieder saubere CH1/CH2-Niederschlags- und Bewölkungswerte statt aufsummierter Wahrscheinlichkeiten und Cloud-Schicht-Salat. Das `weights_used`-Feld zeigt wieder die echte Gewichtung statt Single-Model-Fallback. Die KI sieht plausible Spreads (z. B. 0.1–8.6 mm statt 0.1–397 mm) und kann Aussagen wie „kaum sonnig, am Nachmittag Schauer" wieder belastbar generieren.
