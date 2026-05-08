# Erweiterung Wetterpipeline – 7 neue Features

Ziel: Punkte 1, 2, 7, 9, 10, 11, 12 aus der Lückenliste umsetzen. Alles greift in `src/server/forecast.functions.ts` ein, plus neue Server-Module und eine Mini-Migration für `app_settings`.

## Übersicht

| # | Feature | Quelle | Aufwand |
|---|---------|--------|---------|
| 1 | Wind-Böen | Open-Meteo `wind_gusts_10m` | XS |
| 2 | Gewitter (CAPE + Lifted Index) | Open-Meteo `cape`, `lifted_index` | S |
| 7 | Taupunkt + rel. Feuchte | Open-Meteo `dewpoint_2m`, `relativehumidity_2m` | S |
| 9 | Niederschlagsphase | Ableitung aus T + Td + Schneefallgrenze | S |
| 10 | Blitzdaten | Blitzortung.org-Feed (Bounding-Box JSON) | M |
| 11 | Modell-Spread / Unsicherheit | Aus bestehenden `byModel`-Werten | S |
| 12 | Ensemble (P10/P50/P90) | Open-Meteo `/ensemble` (ECMWF + GEFS) | M |

---

## 1. Wind-Böen (XS)

- `HOURLY_VARS` um `wind_gusts_10m` erweitern.
- Aggregation: Tagesmaximum + Zeitfenster der stärksten Böen.
- Klassen: `<40` ignorieren · `40–60` „kräftige Böen" · `60–80` „stürmische Böen" · `>80` „Sturmböen".
- Deterministischer Satz im Wind-Absatz, Pflicht-Hinweis im `DEFAULT_WIND_RULES`-Prompt.

## 2. Konvektion / Gewitter (S)

- `HOURLY_VARS` um `cape, lifted_index`.
- Helfer `assessThunderstormRisk(hourly)` → `none / isolated / scattered / widespread / severe`:
  - CAPE > 500 + LI < -2 → scattered
  - CAPE > 1500 + LI < -4 → widespread
  - CAPE > 2500 + LI < -6 → severe
- Verknüpfung mit Mehrheit Weathercode 95/96/99 (analog `isFogMajority`).
- Prompt-Pflicht ab `widespread`: „kräftige Gewitter mit Hagel-/Sturmböenrisiko".

## 7. Taupunkt + Feuchte (S)

- `HOURLY_VARS` um `dewpoint_2m, relativehumidity_2m`.
- Zwei Auswertungen:
  - **Schwüle (Sommer):** Td ≥ 16 → „schwül", ≥ 18 → „drückend schwül".
  - **Nebelpotenzial (Nacht):** RH > 95 % + Wind < 5 km/h + klarer Himmel → Hinweis „lokale Nebelfelder in der Frühe".
- Wird im Sky-/Temperatur-Absatz integriert.

## 9. Niederschlagsphase (S)

- Funktion `derivePhase(tempC, dewpointC, snowLineM, elevM)` → `rain | sleet | snow | freezing_rain`.
- Regeln: T < 0 + Niederschlag → freezing_rain; T 0–2 + Td < 0 → snow; T 1–3 → sleet; sonst rain.
- Pro Tagesabschnitt (Morgen/Mittag/Abend) berechnen, Übergänge im Text erwähnen
  („zunächst Schneeregen, am Nachmittag Übergang zu Regen ab 800 m").

## 10. Blitzdaten (M)

- Neuer Server: `src/server/lightning.server.ts`.
- Quelle: Blitzortung.org Bounding-Box-Feed (kostenlos). Fallback Open-Meteo `lightning_potential` falls Feed nicht erreichbar.
- 5-min-Cache (analog Radar). Liefert Blitzanzahl letzte 1h / 3h innerhalb Radius.
- Integration: aktive Blitze → Gewitter-Sätze priorisieren, Nowcast-Block erwähnt Lage.
- Settings: `lightning_enabled boolean`, `lightning_radius_km int default 25` in `app_settings` (Migration).

## 11. Modell-Spread / Unsicherheit (S)

- Helfer `computeSpread(values)` → `{ min, max, p10, p90, stddev }`.
- In `aggregate()` zusätzlich neben `avg` mitspeichern (heute nur Mittelwert).
- Klassifizierung `low | moderate | high` für Tmax, Tmin, Niederschlag.
- Bei `high`: Prompt-Pflicht „Prognoseunsicherheit" + Bandbreite („Tmax 12–18 °C je nach Modell").
- Im `forecast_entries.weather_data`-Debug-Block sichtbar.

## 12. Ensemble (M)

- Neuer Server: `src/server/ensemble.server.ts`.
- Open-Meteo `/v1/ensemble` mit `ecmwf_ifs025` + `gfs_global` (50 + 30 Member).
- Nur Tag 2–7 (Tag 0/1 weiter aus deterministischen CH-Modellen).
- Aggregation: P10/P50/P90 für `temperature_2m_max`, `precipitation_sum`, `windspeed_10m_max`.
- Daraus Wahrscheinlichkeiten: „>5 mm Regen", „>25 °C", „Frost".
- Speist Spread-Logik (#11) automatisch mit zusätzlichen Members.
- Settings: `ensemble_enabled boolean`, `ensemble_min_day int default 2` in `app_settings` (Migration).

---

## Migration

```sql
ALTER TABLE app_settings
  ADD COLUMN lightning_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN lightning_radius_km int NOT NULL DEFAULT 25,
  ADD COLUMN ensemble_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN ensemble_min_day int NOT NULL DEFAULT 2;
```

## Empfohlene Reihenfolge

1. **#1 + #11** (Quick-Wins ohne neuen Endpoint)
2. **#2, #7, #9** (alle nur HOURLY_VARS-Erweiterung + Logik)
3. **#12 Ensemble** (neuer Endpoint, größere Aggregation)
4. **#10 Blitz** (externe Quelle, eigener Cache + Settings)

## Validierung

- Forecast für aktuellen Tag generieren, prüfen dass alle neuen Felder im `weather_data`-JSON erscheinen.
- Manuelles Review der Texte für: Gewittertag, schwüler Sommertag, ruhige Hochdrucklage.
- Server-Logs mit `server-function-logs` checken auf neue API-Fehler.

## Nicht enthalten

Punkte 3 (Schneemenge), 4 (Föhn-Detektor), 5 (UV), 6 (Sicht), 8 (Hitze-Schwellen), 13 (Bergwetter).
