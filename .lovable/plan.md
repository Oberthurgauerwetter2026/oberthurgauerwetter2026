## Ziel

Aktuelle Radar-Niederschlagsdaten (openrad.ch nutzt im Hintergrund MeteoSwiss-Radar) mit den modellierten Werten abgleichen, um die Niederschlagsvorhersage für **Tag 0** (und die nächsten ~2 h) zu schärfen.

## Was openrad.ch liefert — und was wir wirklich nutzen

`openrad.ch` ist nur ein Viewer; es gibt keine offizielle API. Der zugrundeliegende Datensatz ist die **MeteoSwiss Radar-Composite** (`CPC` / `RZC`), kostenlos via **opendata.swiss / MeteoSwiss STAC-API** verfügbar (5-min-Raster, ganz CH inkl. Bodensee/Thurgau). Wir greifen direkt auf diese Quelle zu — keine HTML-Abhängigkeit von openrad.ch.

Fallback, falls die MeteoSwiss-Quelle blockt: **Open-Meteo `radar`-Endpoint** bzw. **DWD RADOLAN/RV** (Süd­deutschland deckt das Hinterland Friedrichshafens ab). Beide liefern georeferenzierte Niederschlagsraster.

## Vorgehen

### 1. Server-Modul `src/server/radar.server.ts`
- Funktion `fetchRecentRadar(lat, lon, radiusKm)`:
  - Lädt die letzten ~12 Radar-Frames (= 1 h) als GeoTIFF/PNG aus dem MeteoSwiss-Bucket
  - Extrahiert Pixel im Radius um den Standort
  - Liefert: `{ tsISO, mmPerH }[]` plus Aggregate `last1h_mm`, `last3h_mm`
- Cache: 5 min in `weather_cache` (über das vorhandene `getOrSetCache` mit `ttlMs`).

### 2. Vergleich Modell vs. Radar (`src/server/radar-bias.server.ts`)
- Holt für die gleiche Stunde die modellierte Niederschlagsmenge (Open-Meteo, bestes Kurzfristmodell — meist `meteoswiss_icon_ch1`).
- Berechnet pro Stunde:
  - **Bias** `radar - model` (mm)
  - **Verhältnis** `radar / max(model, 0.05)` (gedeckelt 0.2–5.0)
- Wenn Radar deutlich abweicht (>0.3 mm absolut **und** >50 % relativ über die letzte Stunde):
  - Tag 0 `precip_sum` korrigieren via Verhältnis (gedeckelt) für die noch verbleibenden Stunden
  - `precip_prob` nur erhöhen, nicht senken (vermeidet falsche Trockenmeldung)
- Ergebnis wird in `forecast_entries.weather_data.radar_correction` protokolliert (nachvollziehbar).

### 3. Kurz-Nowcast (0–2 h)
- Einfache Persistenz: `mmPerH` der letzten 30 min wird als Erwartung für die nächsten 60–120 min übernommen, linear ausklingend.
- Wird im UI / Bericht als „Aktuelle Radarlage" zusätzlich angezeigt (nicht in `precip_sum` von Tag 0 doppelt einrechnen).

### 4. Integration in `forecast.functions.ts` / `forecast.auto.ts`
- Reihenfolge bleibt: Open-Meteo → MOSMIX (Tag 0/1) → **Radar-Korrektur (nur Tag 0)** → Topo → Stationsbias (sofern kein MOSMIX).
- Radar wird **nicht** mit MOSMIX-Niederschlag verrechnet, sondern *nach* MOSMIX angewendet, da Radar = beobachtete Realität.

### 5. Settings-UI (`src/routes/_app.settings.tsx`)
Neue Karte **„Radar-Abgleich (MeteoSwiss)"**:
- Switch `radar_enabled` (Default an)
- Slider `radar_radius_km` (Default 15, identisch zum allg. Radius)
- Slider `radar_correction_strength` (0–100 %, Default 70 %) — dämpft die Korrektur
- Info-Text mit Hinweis auf 5-min-Auflösung und 5-min-Cache.

### 6. DB-Migration
`app_settings` um drei Spalten erweitern:
- `radar_enabled boolean not null default true`
- `radar_radius_km integer not null default 15`
- `radar_correction_strength integer not null default 70`

## Was bewusst **nicht** gemacht wird

- Kein Scraping von `openrad.ch` (instabil, keine Lizenz für Datenweitergabe).
- Keine eigene Radar-Extrapolation per ML — Aufwand zu hoch, MeteoSwiss INCA reicht für unsere Zwecke nicht via offene API.
- Kein Eingriff in Tag 1+ (Radar hat keinen Mehrwert >3 h).

## Risiken / offene Punkte

- **Datenformat**: MeteoSwiss liefert `RZC`/`CPC` als binäres Grid. Falls das Parsing im Worker zu schwer wird (Sharp/GDAL nicht verfügbar), Fallback auf den **Open-Meteo `precipitation_radar`**-Endpoint, der bereits Punktwerte als JSON liefert — dann entfällt das Geo-Parsing komplett.
- **Latenz**: Radar ist ~10 min alt, was für stündliche Bias-Korrektur völlig ausreicht.

## Frage vor Umsetzung

Soll ich direkt den **Open-Meteo Radar-Endpoint** verwenden (deutlich einfacher, JSON, keine GeoTIFF-Hürde, gleiche MeteoSwiss-Quelle im Hintergrund) oder echt die MeteoSwiss STAC-API anbinden (mehr Kontrolle, mehr Aufwand)?
