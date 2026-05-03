## Ziel

Für **heute** und **morgen** (Tag 0/1) die Modellrohwerte durch das **ICON Model Output Statistics (MOS)** des DWD ersetzen. MOSMIX ist bereits statistisch gegen Stationsmessungen kalibriert — damit fällt unsere eigene Bias-Korrektur (`buildStationBiases`) im Kurzfristbereich weg, und die kurzfristige Prognose wird realistischer und stabiler.

## Datenquelle

- **DWD MOSMIX_L** (alle 6 h aktualisiert: 03/09/15/21 UTC), Einzelstationen, KMZ-Format.
- Stationen rund um Amriswil (im 30-km-Radius):
  - **10935 Friedrichshafen** (Bodensee-Nordufer, "warm")
  - **10929 Konstanz** (Bodensee, "warm")
  - Optional: **06660 Sigmaringen** als Hinterland-Referenz
- Endpoint: `https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/<id>/kml/MOSMIX_L_LATEST_<id>.kmz`
- Kostenlos, ohne Key, ohne Tageslimit.

## Verwendete MOSMIX-Parameter (stündlich → Tagesaggregat)

| Code   | Bedeutung                  | Aggregation |
|--------|----------------------------|-------------|
| `TTT`  | Temperatur 2 m (K)         | min/max/avg |
| `Td`   | Taupunkt                   | avg         |
| `FF`   | Wind 10 m mittl. (m/s)     | avg → km/h  |
| `FX1`  | Böe 1 h (m/s)              | max → km/h  |
| `DD`   | Windrichtung (°)           | circular avg|
| `Neff` | Bewölkung effektiv (%)     | avg         |
| `RR1c` | Niederschlag 1 h (mm)      | sum         |
| `SunD1`| Sonnenscheindauer 1 h (s)  | sum → h     |
| `wwM`  | Signifikantes Wetter       | dominant    |

## Änderungen

### 1. Neuer Server-Helper `src/server/mosmix.server.ts`

- `fetchMosmixStation(stationId)` → lädt KMZ, entpackt mit `fflate` (Worker-tauglich, pure JS), parst KML mit Regex/`fast-xml-parser`.
- `aggregateMosmixDaily(timeSteps, values, tz="Europe/Zurich")` → liefert Tagesblöcke im gleichen Schema wie unsere bestehenden `weather_data`-Tagesobjekte (`tmin/tmax/precip/wind_max/cloudcover/sunshine_h/...`).
- `buildMosmixShortTerm(lat, lon)` → wählt nächstgelegene 1-2 Stationen, gewichtet nach Distanz (inverse-distance), liefert **2 Tage** (heute, morgen).
- Gecached über bestehenden `getOrSetCache` mit Key `mosmix:short:<stations>` und TTL **2 h** (MOSMIX_L kommt alle 6 h, dazwischen unverändert).

### 2. Integration in `fetchWeather` (in `forecast.functions.ts`)

```text
shortData (Tag 0-1):
  ├─ MOSMIX-Quelle (Primär)        ← NEU
  └─ Open-Meteo short (Fallback wenn MOSMIX leer/fehlt)

midData (Tag 3-5)   → unverändert (Open-Meteo, gecached)
longData (Tag 6-10) → unverändert (Open-Meteo, gecached)
```

- Wenn MOSMIX erfolgreich liefert: short-Tier wird daraus gebildet, **kein** Open-Meteo-Short-Call mehr.
- Datenfeld `weather_data.source` pro Tag ergänzen (`"mosmix" | "open-meteo"`), damit im UI sichtbar ist, woher der Wert stammt.

### 3. `applyStationBias` für Tag 0/1 deaktivieren

In den Aufrufstellen: wenn `day.source === "mosmix"`, wird **kein** zusätzlicher Stations-Bias mehr abgezogen (würde sonst doppelt korrigieren). Topographische Spreizung (`applyTopography`) läuft weiterhin, da sie das Modell räumlich auffächert (Senken/Höhen) — sie ist eine eigenständige Information.

### 4. Settings-Eintrag

Neues Feld in `app_settings`:

- `mosmix_enabled boolean default true`
- `mosmix_stations text default '10935,10929'` (Komma-Liste)

UI-Zugang in `_app.settings.tsx` unter "Wetterdaten" als Schalter + Texteingabe.

### 5. Dependency

- `bun add fflate fast-xml-parser` (beide reine JS, Worker-kompatibel).

## Effekt

- **Tag 0/1**: MOS-korrigierte ICON/IFS-Werte → keine Eigen-Bias-Korrektur mehr nötig, deutlich näher an realen Messungen, **0 zusätzliche API-Calls** zu data.tg.ch im Kurzfristbereich.
- **Tag 3+**: bleibt wie bisher (Open-Meteo-Cache + Stations-Bias).
- API-Last DWD: 1 Call pro Station alle 2 h, also max. **2-3 Calls/Tag** insgesamt — DWD hat **kein** Limit.
- `buildStationBiases` wird nur noch für Tag 2-5 angewendet (nicht mehr Tag 0/1).

## Was nicht geändert wird

- `regenerateEntry`, Topographie, Auto-Job-Scheduling, UI-Generierung, Prompts.
- `weather_cache` und Cache-Logik (wird wiederverwendet).
