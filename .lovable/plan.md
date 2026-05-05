# Geo- & Topografie-Erweiterungen

Vier zusätzliche Layer für die Prognose. Punkt 1 ist nur eine Übernahme bestehenden Codes, Punkte 2–4 bringen echte neue Daten.

## 1. Topografie-Block in der manuellen Generierung sichtbar machen

**Status quo:** `applyTopography` läuft bereits in `generateForecast` (Zeile 1320 in `src/server/forecast.functions.ts`) und liefert `tmin_cold` / `tmin_ridge` / `tmax_warm` pro Tag. Die Werte landen im `weather_data`-Block, werden im Dashboard / Detail-View aber nicht angezeigt.

**Umsetzung**
- In `src/components/WeatherDataView.tsx` einen neuen Abschnitt "Lokale Differenzierung" einfügen, der `weather_data.topography` rendert:
  - Senken (z. B. "Hudelmoos / Riedflächen"): `tmin_cold` °C
  - Höhenlagen (Hügelzüge): `tmin_ridge` °C
  - Sonnige Lagen am Bodensee-Ufer: `tmax_warm` °C
  - Klassifikation (Strahlungsnacht / teilweise klar / bedeckt) + Lapse-Rate als Tooltip
- Werte wie bisher dem KI-Prompt mitgeben, damit der Text z. B. "in den Riedflächen örtlich Bodenfrost" formulieren kann (bereits implementiert in `forecast.auto.ts`, in `forecast.functions.ts` ergänzen).

## 2. Föhn-/Bise-Index aus Druckgradient

Neuer Server-Helper `src/server/pressure-gradient.server.ts`.

**Datenquelle:** Open-Meteo Stationsdruck (`pressure_msl`) für vier Punkte:
- Süd: Lugano (46.00 / 8.95)
- Nord: Zürich-Kloten (47.48 / 8.54)
- West: Genf (46.25 / 6.13)
- Ost: St. Gallen (47.43 / 9.40)

**Berechnung pro Tag (Tagesmittel):**
- `dp_foehn = p(Lugano) − p(Zürich)` → Werte > +4 hPa = Föhntendenz, > +8 hPa = Föhnlage
- `dp_bise  = p(Genf) − p(St. Gallen)` → Werte < −3 hPa = Bisentendenz, < −6 hPa = kräftige Bise
- Klassifikation: `none | foehn_weak | foehn_strong | bise_weak | bise_strong`

**Integration**
- Wird einmal pro `generateForecast`-Call abgerufen (Cache 60 min) und pro Tag zugeordnet.
- Block `wind_regime: { class, dp_foehn, dp_bise }` ans Tagesobjekt anhängen.
- Im KI-Prompt als Hinweis: "Bei `foehn_strong` Hinweis auf föhnige Aufhellungen / milde Temperaturen; bei `bise_strong` Hinweis auf trockenkalte Nordostwind­lage."
- Im UI als kleines Badge "Föhn" / "Bise" mit hPa-Wert als Tooltip.

## 3. Schneefallgrenze aus Open-Meteo

**Datenquelle:** `freezing_level_height` (m über Meer) ist im Open-Meteo Hourly-Endpoint bereits verfügbar — kein neuer API-Call, nur ein zusätzliches Feld in der bestehenden Anfrage in `forecast.functions.ts` (`fetchOpenMeteoEnsemble`).

**Berechnung**
- Pro Tag: `min`, `avg`, `max` der stündlichen `freezing_level_height`.
- Schneefallgrenze ≈ `freezing_level − 200 m` (Standard-Daumenregel).
- Klassifikation relativ zur Region (Default 434 m bis ~900 m im 15-km-Radius):
  - `> 1500 m` → kein Schnee relevant (nicht anzeigen)
  - `900–1500 m` → Schnee nur auf höchsten Hügelzügen (Tooltip)
  - `< 900 m` → "Schneefallgrenze sinkt bis auf XYZ m" — prominente Anzeige + KI-Hinweis

**Integration**
- Block `snow_line: { freezing_min, freezing_avg, snow_line_min, class }` ans Tagesobjekt.
- UI: Anzeige nur bei Klasse ≠ none, ggf. mit Icon.
- KI-Prompt: bei `< 900 m` und Niederschlag > 1 mm explizit Schneefall in Höhenlagen erwähnen.

## 4. Reliefkarte im Dashboard (MapLibre + Swisstopo)

Neue Komponente `src/components/RegionMap.tsx`.

**Stack**
- `maplibre-gl` (npm-Package, läuft komplett im Browser, keine Worker-Probleme).
- Tile-Layer: Swisstopo WMTS, gratis & ohne API-Key:
  - Basis: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`
  - Optional Relief-Overlay: `ch.swisstopo.swissalti3d-reliefschattierung` mit Alpha 0.4

**Features**
- Marker für Standort (aus `app_settings.location_lat/lon`).
- Marker für die SMN-Bias-Stationen (GUT, STG, TAE) und MOSMIX-Stationen.
- Radius-Kreis (`radius_km` aus Settings, Default 15 km) als visuelles Pendant zum Topografie-Raster.
- Optional: Legende mit Höhenstufen (min / median / max aus `topo_elev_*`).

**Wo eingebaut**
- Auf `/dashboard` als kollabierbare Karte unter den Einstellungen.
- Auf `/forecast/$forecastId` (Detailansicht) als kleiner Übersichts-Header.

## Technische Reihenfolge

1. Topografie-Anzeige (`WeatherDataView.tsx`) + Topografie in `generateForecast`-KI-Prompt.
2. `pressure-gradient.server.ts` + Integration in `forecast.functions.ts` + UI-Badge.
3. `freezing_level_height` zur Open-Meteo-Anfrage hinzufügen + `snow_line`-Block + UI.
4. `bun add maplibre-gl` + `RegionMap.tsx` + Einbindung in `_app.dashboard.tsx` und `_app.forecast.$forecastId.tsx`.

## Was nicht im Scope ist

- Echte Hangneigungs-/Expositionsanalyse (bräuchte DEM-Tile-Verarbeitung, deutlich aufwendiger).
- Dynamische Föhn-Erkennung aus Stationswind (zusätzlich zu Druck) — Druckgradient ist die robustere Standardmethode und reicht für die Textgenerierung.
- 3D-Gelände in der Karte (MapLibre kann das, aber kostet Performance — kann später als Toggle nachgereicht werden).
