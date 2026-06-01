## Ziel

In der Wetterprognose werden nur noch folgende Modelle verwendet:

- **Kurzfrist (Tag 1–2):** MeteoSchweiz ICON-CH1, ICON-CH2
- **Mittelfrist / Langfrist (Tag 3–10):**  ICON-CH2, ECMWF IFS, GFS Global
- **Statistische Stützung (Tag 2+):** DWD MOSMIX (bleibt unverändert)

Entfernt werden überall: **AROME (meteofrance_arome_france_hd)**, **ICON-D2**, **ARPEGE Europe**, **ICON-EU**.

## Änderungen

### 1. Default-Modelllisten (Code)

- `src/server/forecast.functions.ts` (Zeilen ~985–987): Defaults für `shortModels`, `midModels`, `longModels` anpassen.
- `src/server/forecast.auto.ts` (Zeilen ~171–173): identisch anpassen.
- `src/routes/_app.settings.tsx` (Zeilen 41–43, 80–82, 250, 254, 258): Form-Defaults und Input-Placeholder aktualisieren; Beschreibungstext in der Card (Zeile 243–244) auf die neue Auswahl umschreiben.

Neue Werte:

- `models_shortterm = "meteoswiss_icon_ch1,meteoswiss_icon_ch2"`
- `models_midterm   = "meteoswiss_icon_ch2,ecmwf_ifs025,gfs_global"`
- `models_longterm  = "ecmwf_ifs025,gfs_global"`

### 2. Default-Werte in DB

Neue Migration, die die Defaults der Spalten `app_settings.models_shortterm/midterm/longterm` setzt **und** bestehende Zeilen aktualisiert, sofern sie noch auf den alten Defaults stehen (so wie die bestehende Migration `20260514155532...sql` es vormacht).

### 3. Gewichtstabellen in `src/server/forecast.functions.ts`

Einträge für entfernte Modelle aus den Tabellen löschen und Restgewichte auf Summe 1.0 umnormieren:

- `WIND_WEIGHTS` (Z. 118): nur `icon_ch1` + `icon_ch2`.
- `CLOUD_SUN_WEIGHTS` (Z. 2184): `icon_ch1`, `icon_ch2`, `ecmwf_ifs025`.
- `TEMP_HOURLY_WEIGHTS` (Z. 2244): `icon_ch1`, `icon_ch2`.
- `PRECIP_HOURLY_WEIGHTS` (Z. 2252): `icon_ch1`, `icon_ch2`.
- `HORIZON_WEIGHTS` (Z. 1273–1276) und `REGIME_WEIGHTS` / Variable-Modifier (Z. 1255–1265): Spalten `arome`, `arpege`, `icon_d2`/`other` aus den Maps entfernen, ICON-CH1/CH2 und ECMWF/GFS bleiben. `ModelKey`-Typ (Z. 1230) und `classifyModel`-Helper (Z. 1239–1240) entsprechend reduzieren.
- `forecast.auto.ts` `WIND_WEIGHTS` (Z. 45) analog auf ICH-CH1/CH2 reduzieren.

`ICON_KEYS` (Z. 2551) auf `["meteoswiss_icon_ch1","meteoswiss_icon_ch2"]` kürzen. `HOURLY_LONGRANGE_BLOCKLIST` bleibt (ECMWF/GFS-Stundenwerte sind weiterhin sinnlos in Kurzfrist-Aggregaten).

### 4. R2-Ingest

`scripts/ingest_openmeteo.py` Phase A `models` (Z. 119) auf `"meteoswiss_icon_ch2,ecmwf_ifs025,gfs_global"` reduzieren (ICON-CH1 läuft bereits in Phase B). Phase C `best_match` bleibt — wird nur für Bias-Lookback genutzt, nicht für die Prognose-Mischung.

## Nicht angefasst

- **Radar / Nowcast** (`src/server/radar.server.ts`): nutzt ICON-CH1 primär und ICON-D2 nur als Vergleichswert für die Radar-Assimilation. Der User-Request bezieht sich auf die *Wetterprognose*, daher bleibt Radar unverändert. Falls ICON-D2 auch hier raus soll, bitte kurz Bescheid geben.
- **Druckkarte / Synoptik** (`pressure-map-generator/generate.mjs`, `synoptic-trend.server.ts`): nutzen schon nur ECMWF + GFS → keine Änderung.
- **MOSMIX** (`src/server/mosmix.server.ts`): bleibt unverändert.

## Verifikation

Nach den Edits einmal eine Prognose generieren und prüfen, dass die `weights_used`-Felder in `weather_data` nur noch die gewünschten Modelle enthalten und keine Referenzen auf `arome`/`arpege`/`icon_d2` mehr auftauchen.