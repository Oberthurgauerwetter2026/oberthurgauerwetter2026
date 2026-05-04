# Zonen-Differenzierung (umgesetzt)

Räumliche Differenzierung der gesamten Prognose datengetrieben statt sprachlich. Vier Prognose-Punkte im Oberthurgau-Perimeter, ein zusätzlicher Open-Meteo Multi-Coord-Call, Zonen-Werte für alle Variablen im Prompt.

## Was umgesetzt wurde

1. **`ZONES`-Konstante** mit vier Punkten:
   - ost: Horn (47.494 / 9.434)
   - mitte: Romanshorn (47.566 / 9.378)
   - west: Münsterlingen (47.633 / 9.235)
   - hinterland: Hauptwil-Gottshaus (47.490 / 9.275)

2. **`fetchZonesTimeline()`**: Multi-Coord-Call mit `icon_d2` für 9 Daily-Variablen (tmax/tmin/precip/precip_prob/wind_max/wind_gusts_max/wind_dir/sunshine/cloudcover). Eigener Cache-Key, fail-soft.

3. **`formatZones(weather, dateStr)`**: liefert pro Tag ein `zones`-Objekt mit Werten je Punkt + `range` + `spread` + `significant_diffs`-Array.

4. **Schwellwerte für `significant_diffs`**:
   - Temperatur > 2 °C
   - Niederschlag > 3 mm oder Faktor > 3×
   - Wind > 15 km/h, Böen > 20 km/h
   - Bewölkung > 30 %
   - Sonnenschein > 2 h

5. **`fetchWeather()`** liefert `zonesData` zusätzlich zu byModel — bestehende Pipeline unberührt.

6. **`formatDayData`** ergänzt automatisch `zones` im Tagesobjekt — keine Änderung an den 6 Prompt-Injection-Stellen nötig.

7. **System-Prompt-Block ZONEN-DIFFERENZIERUNG** nach FÖHN-HINWEIS — gilt für alle Wetterlagen, mit Whitelist erlaubter Ortsnennungen und expliziten Verboten (Rheintal, Steckborn etc.).

## Quota-Impact

- 1 zusätzlicher Open-Meteo-Call pro Generation (cached bis Mitternacht).
- JSON pro Tag ~3–5 KB grösser, Prompt-Token ~10 % mehr.
- Generation-Latenz: vernachlässigbar.

## Nächste Schritte (Phase 2, optional)

- SwissMetNet Altenrhein als Live-Validierung Tag 0 (Ost-Referenz, ergänzt Güttingen).
- Quota-Verbrauch nach 1–2 Tagen real prüfen.
- Bei Bedarf weitere Schwellwerte nachjustieren.
