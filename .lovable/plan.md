# Eigene Bias-Korrektur mit SwissMetNet-Stationen

Erweiterung der bestehenden DWD-MOSMIX-Logik um Schweizer Mess-Stationen (SwissMetNet via Open-Data-Portal von MeteoSchweiz). Damit wird das „SuperHD"-Prinzip von Kachelmann nachgebildet: Modell-Vorhersagen werden gegen reale Stations-Messungen der letzten Tage abgeglichen, ein gleitender Bias berechnet und auf die kommende Vorhersage angewendet.

## Datenquelle

**MeteoSchweiz Open Data — SMN** (`opendatadocs.meteoswiss.ch`)
- Kostenlos, offiziell, ohne API-Key
- CSV-Endpoints mit 10-min und stündlichen Werten je Station
- Relevante Stationen (Region Oberthurgau): GUT (Güttingen), STG (St. Gallen), SMA (Zürich-Fluntern), KLO (Kloten), TAE (Aadorf/Tänikon)
- Parameter: Temperatur (`tre200s0`), Wind (`fkl010z0`), Niederschlag (`rre150z0`), Sonnenschein (`sre000z0`), Bewölkung

## Funktionsweise

```text
            Letzte 7 Tage                Aktuell / nächste Tage
   ┌─────────────────────────┐      ┌────────────────────────┐
   │  Modell-Forecast (alt)  │      │  Modell-Forecast (neu) │
   │            ↕             │      │           +            │
   │  SMN-Messung (real)     │      │   Bias-Korrektur       │
   └────────┬────────────────┘      └───────────┬────────────┘
            │ Δ pro Parameter                   │
            └──→ gleitender Bias  ─────────────→┘
                 (T, Wind, Niederschlag-Faktor)
```

## Umsetzung

### 1. Neuer Server-Modul `src/server/swissmetnet.server.ts`
- `fetchSmnRecent(stationIds, hours)` — lädt CSV-Reihen der letzten 168 h
- 1 h Cache (`getOrSetCache`)
- Robustes CSV-Parsing, Worker-tauglich (kein Node-spezifisches FS)

### 2. Neuer Server-Modul `src/server/bias-correction.server.ts`
- `computeBias(stationData, modelHistory)` — vergleicht SMN-Messung mit Open-Meteo-Modell-Hindcast (`past_days=7`)
- Liefert pro Parameter:
  - **Temperatur:** mittlerer additiver Bias (°C)
  - **Wind:** multiplikativer Faktor
  - **Niederschlag:** Verhältnis (clamped 0.5–2.0)
- Gewichtung: jüngere Tage zählen mehr (exponentielle Glättung)
- `applyBias(dayData, bias)` — wendet Korrektur auf Tage 0–2 an

### 3. Integration in `forecast.functions.ts` und `forecast.auto.ts`
- Nach MOSMIX-Schritt, vor Radar-Schritt
- Nur für Tage, an denen MOSMIX *nicht* schon korrigiert hat (also Tag 2 — Tag 0/1 macht MOSMIX besser)
- Optional auch für CH-Region zusätzlich zu MOSMIX wenn die Distanz zur nächsten DWD-Station > 30 km

### 4. Erweiterte Modell-Defaults
- `models_shortterm`: zusätzlich `ukmo_seamless`
- `models_midterm`: zusätzlich `meteofrance_arpege_europe`
- `models_longterm`: zusätzlich `ukmo_seamless`
→ Default-Wert in DB-Migration aktualisieren (bestehende Werte bleiben unverändert)

### 5. Settings-UI (`src/routes/_app.settings.tsx`)
Neue Karte **„Bias-Korrektur (SwissMetNet)"**:
- Toggle `bias_enabled`
- Input `bias_stations` (z.B. `GUT,STG,TAE`)
- Slider `bias_lookback_days` (3–14, Default 7)
- Slider `bias_strength` (0–100 %, Default 70)

### 6. Datenbank-Migration
Neue Spalten in `app_settings`:
- `bias_enabled boolean default true`
- `bias_stations text default 'GUT,STG,TAE'`
- `bias_lookback_days int default 7`
- `bias_strength int default 70`

## Was du danach siehst

Im `weather_data`-JSON pro Tag ein neues Feld:
```json
"bias_correction": {
  "applied": true,
  "stations": ["GUT","STG"],
  "delta_temp": -0.4,
  "factor_wind": 1.08,
  "factor_precip": 0.92,
  "lookback_days": 7
}
```

Damit: voll transparenter, eigener „SuperHD-light"-Layer ohne Kachelmann-Lizenz, vollständig legal, mit Open-Data-Quellen.

## Aufwand
~3 neue/angepasste Dateien, 1 Migration. Erste sinnvolle Korrekturen ab Tag 2 (für Tag 0/1 bleibt MOSMIX überlegen, da bereits stations-kalibriert).