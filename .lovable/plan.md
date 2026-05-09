## Wetterlagen-abhängige Modell-Gewichtung

Aktuell läuft `aggregate()` mit statischen Gewichten (`MODEL_WEIGHTS`, nur GFS = 0.5). Idee: Gewichte pro Variable + Wetterlage anpassen, sodass jedes Modell dort zählt, wo es nachweislich stark ist.

### Stärken-Profil der Modelle

| Modell | Stark bei | Schwach bei |
|--------|-----------|-------------|
| ICON-CH1 (1 km, MeteoSwiss) | Konvektion, lokale Niederschläge, Föhn, Bise | Großwetterlage Tag 3+ |
| ICON-CH2 (2 km, MeteoSwiss) | Alpennordseite allgemein, Bewölkung | extreme Konvektion |
| AROME-HD (1.3 km, Météo-France) | Westlagen, Niederschlag, Gewitter | Ostlagen, Bise |
| ARPEGE Europe (~11 km) | Großwetterlage, Wind, Frontensysteme | lokale Konvektion |
| ECMWF IFS (Trend) | Temperatur-Trend, stabile Hochs | Konvektion, Detail |
| GFS (Trend) | breiter Vergleich | tendenziell zu nass, schwach in Alpen |

### Wetterlagen-Erkennung

Ableitung aus bereits vorhandenen Daten — kein zusätzlicher API-Call:

| Lage | Trigger (Tagesmittel über 0–24h) |
|------|----------------------------------|
| `convective` | CAPE > 800 oder LI < −2 |
| `frontal_west` | Wind 200°–290° UND Niederschlag > 5 mm |
| `foehn_south` | Druckgradient SW→NO < −4 hPa (aus `pressure-gradient.server.ts`) |
| `bise_ne` | Wind 30°–80° UND Wind > 25 km/h |
| `stable_high` | Bewölkung < 30 % UND Niederschlag < 0.5 mm UND Wind < 15 km/h |
| `default` | sonst |

Erkennung pro Tag in neuem Helper `classifyRegime(weather, dayIndex)`.

### Gewichts-Matrix

Neuer Helper `regimeWeight(model, variable, regime)` ersetzt `modelWeight(name)`. Basis = 1.0, Modifikatoren:

```
convective:    ICON-CH1 ×1.6, AROME-HD ×1.4, ICON-CH2 ×1.1, ARPEGE ×0.7, ECMWF ×0.7, GFS ×0.5
frontal_west:  AROME-HD ×1.5, ARPEGE ×1.3, ICON-CH2 ×1.1, ICON-CH1 ×1.0, ECMWF ×0.9, GFS ×0.6
foehn_south:   ICON-CH1 ×1.5, ICON-CH2 ×1.3, AROME-HD ×0.9, ARPEGE ×0.8, ECMWF ×0.8, GFS ×0.5
bise_ne:       ICON-CH2 ×1.4, ICON-CH1 ×1.3, ARPEGE ×1.1, AROME-HD ×0.8, ECMWF ×0.9, GFS ×0.6
stable_high:   ECMWF ×1.4, ARPEGE ×1.2, ICON-CH2 ×1.1, ICON-CH1 ×1.0, AROME-HD ×0.9, GFS ×0.7
default:       alle ×1.0, GFS ×0.5
```

Zusätzlich: **Variablen-spezifisch** überlagern (immer aktiv, nicht regime-abhängig):
- `precipitation*` + `weathercode`: AROME-HD und ICON-CH1 leicht bevorzugen (×1.1)
- `temperature_2m*`: ECMWF leicht bevorzugen (×1.1)
- `windspeed_10m*` + `wind_gusts_10m`: ARPEGE + ICON-CH2 leicht bevorzugen (×1.1)

Final = `base_regime_weight × variable_modifier`.

### Umsetzung

1. **Neuer Helper `classifyRegime()`** in `forecast.functions.ts` (~30 Zeilen). Liest `pressure-gradient.server.ts`-Output und Hourly-Werte (CAPE, LI, Wind, Niederschlag).
2. **`MODEL_WEIGHTS` ersetzen** durch `REGIME_WEIGHTS: Record<Regime, Record<ModelKey, number>>` und `VAR_MODIFIERS: Record<VarGroup, Record<ModelKey, number>>`.
3. **`aggregate(perModel, opts?)`** um optionale `{ variable, regime }`-Params erweitern. Aufrufer (`formatDayData`) übergeben `variable` und das tagesweise berechnete `regime`.
4. **Debug-Output**: Pro Tag im `weather_data.debug.regime` speichern → in `WeatherDataView` sichtbar.
5. **Settings-Schalter** `regime_weighting_enabled` (Default `true`) in `app_settings`, damit du A/B vergleichen kannst.

### Validierung

- Für aktuellen Tag (`/forecast/...`) prüfen: `weather_data.debug.regime` plausibel?
- Konvektionstag: ICON-CH1-Werte sollten Aggregat dominieren (sichtbar an `avg` näher an ICON-CH1 als an ARPEGE).
- Stabile Hochlage: ECMWF dominiert.
- Vergleich Prognose mit/ohne Schalter über 1–2 Wochen.

### Was bleibt unverändert

- Tier-Zuordnung (Kurz/Mittel/Trend) und die Modell-Listen aus letzter Änderung.
- `spread`, `p10/p50/p90`, `byModel`-Debug — Gewichte beeinflussen nur `avg`.

### Risiken

- Falsche Regime-Erkennung → falsche Gewichte. Mitigations: Schwellenwerte konservativ, Default-Regime als Fallback, Debug sichtbar.
- Mehr Komplexität bei Fehlersuche → Debug-Block im UI ist Pflicht.