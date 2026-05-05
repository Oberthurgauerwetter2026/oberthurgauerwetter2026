## Ziel

Die Prognose 0 – 12 h (erster Tageseintrag, "Heute" / "Heute Abend & Nacht") wird systematisch an **Beobachtungen** verankert statt am rohen Modell. MOSMIX bleibt **Feature**, nicht Endwert. Radar, SMN-Stationen und stündliches Bias-Learning bestimmen Temperatur, Bewölkung, Wind und Niederschlag der nächsten 12 Stunden.

## Was sich konkret ändert

### 1. Neuer Nowcast-Layer (`src/server/nowcast.server.ts`)

Liefert für die nächsten 12 Stunden eine stündliche, beobachtungs-verankerte Reihe:

- **Stationen jetzt** (SMN GUT/STG/TAE, letzte 1 – 3 h): aktuelle T, Wind, Bewölkung %, Niederschlag.
- **Radar Trend**: bisherige Funktion `fetchRadarSnapshot` liefert Beob. 3 h + Nowcast 2 h. Wird auf 0 – 6 h erweitert (`forecast_hours=6`).
- **Modell-Hindcast** (gleiche Stunden, die schon Realität sind) → Bias je Variable und je Stunde-Offset.
- **Blend-Funktion** für jede Vorhersagestunde h (0 – 12):
  - Gewicht Beobachtung/Radar: `w_obs = max(0, 1 - h/6)` (1.0 → 0.0 bei h=6)
  - Gewicht Nowcast (Radar + persistierte Stationsabweichung): voll bis h=2, linear bis h=6
  - Gewicht Modell (MOSMIX bevorzugt, sonst CH1): Rest
  - Bewölkungs-Realitätscheck: wenn SMN aktuell `cloud_pct` ≥ 80 und Modell < 40 → Modell-Bewölkung anheben **und** Tagesmax-T um abgeleitetes Δ (Faustformel `−0.4 °C pro 10 % zusätzlicher Bewölkung tagsüber`) absenken (umgekehrt analog).
  - Wind: multiplikativer Faktor aus letzten 3 h (geclamped 0.6 – 1.6).
  - Niederschlag 0 – 2 h: ausschließlich Radar-Nowcast; 2 – 6 h: Mischung; 6 – 12 h: Modell + Skalierung aus `radar_correction.ratio`.

### 2. Nacht separat modellieren

Separate Funktion `nightAdjustment(lastHourSmn, modelNight)`:
- **Klarheit (cloud_pct < 30) + windstill (< 8 km/h)** → zusätzliche Auskühlung: `tmin_night − Δ` mit Δ = 1 – 3 °C abhängig von Wind und Bodenfeuchte (Proxy: Niederschlag der letzten 24 h aus SMN; trocken → mehr Auskühlung).
- **Bedeckt + windig** → Δ = 0, Modell unverändert.
- **Nebel-Heuristik**: wenn SMN aktuell `cloud_pct` ≥ 80 und T-Taupunkt-Spread < 1 °C (aus stündlichem Open-Meteo-Feld `dewpoint_2m` ableiten) → Hinweis-Flag `night_fog_likely=true` an den Prompt geben; tmin nicht weiter absenken.

### 3. Recent Bias Learning pro Stunde

`bias-correction.server.ts` heute: ein globaler Δ T / Faktor Wind/Niederschlag über alle Stunden gemittelt. Erweiterung:

- Bias **pro Stunde-of-day** (24 Buckets) und **pro Lead-Hour** (0, 3, 6, 12) lernen.
- Halbwertszeit auf 36 h reduzieren (statt 2 Tage), damit aktuelle Wetterlage stärker zählt.
- Zusätzlicher **Cloud-Bias** Δ % bereits jetzt vorhanden – wird auf Stunden-Buckets ausgedehnt.
- Speicherung weiterhin im In-Memory-Cache (`weather-cache.server`), TTL 1 h.

Das Ergebnis (`HourlyBias`) wird vom Nowcast-Layer **vor** dem Blend angewendet.

### 4. MOSMIX als Feature, nicht Endwert

In `forecast.functions.ts` (`buildDay` / `withTopo`) für `dayIndex === 0`:
- MOSMIX-Tageswerte werden **nicht mehr 1:1 übernommen**, sondern fließen als **eines von mehreren Inputs** in die neue `buildNowcastDay(weather, mosmix, radar, smn, hourlyBias)`-Funktion.
- Diese liefert tmin/tmax/precip/wind/cloudcover als gewichtete Kombination. MOSMIX-Originalwerte landen in `mosmix_reference` (analog zum bestehenden `om_reference`).
- Tag 1 bleibt MOSMIX-dominiert (24 – 48 h), nur leichte Bias-Korrektur.

### 5. Erster Eintrag (`buildFirstEntryContext`)

Wird mit dem Nowcast-Output gefüttert. Zusätzliche Felder im Prompt:
- `observed_now`: aktuelle SMN-Werte (T, Bewölkung, Wind, Regen letzte 1 h).
- `next_2h`: Radar-Nowcast Niederschlag + Trend (zunehmend / abnehmend / trocken).
- `confidence`: "hoch" wenn Beobachtung & Modell übereinstimmen, "niedrig" wenn Korrektur > 30 %.
- `night_fog_likely`, `night_extra_cooling_c`.

Der System-Prompt erhält eine kurze Anweisung, bei `confidence: "niedrig"` vorsichtiger zu formulieren ("zeichnet sich ab", "deutet sich an").

### 6. Settings (DB-Migration)

Neue Spalten in `settings` (alle mit Defaults, kein UI-Zwang nötig):
- `nowcast_enabled boolean default true`
- `nowcast_obs_horizon_h int default 6` (bis zu welcher Lead-Stunde Beobachtung dominiert)
- `night_clear_cooling_c numeric default 1.5` (max. Δ bei Klarnacht)
- `bias_per_hour_enabled boolean default true`

## Technische Details

```text
src/server/
  nowcast.server.ts          NEU – Blend-Layer 0–12 h
  bias-correction.server.ts  ERWEITERT – Buckets pro Stunde + Lead
  forecast.functions.ts      ANGEPASST – buildDay(0) ruft Nowcast,
                             buildFirstEntryContext nutzt Nowcast-Output
  radar.server.ts            ANGEPASST – forecast_hours 2 → 6
  swissmetnet.server.ts      ANGEPASST – Dewpoint optional aus OM holen
                             (für Nebel-Heuristik)
```

Blend-Gewichte sind Konstanten oben in `nowcast.server.ts` und gut dokumentiert, sodass sie ohne weitere Migration justierbar sind.

## Was nicht geändert wird

- Tage 2 – 5: bleiben Open-Meteo-Multimodell-Mittel + Stations-Bias (bestehender Pfad).
- Trend Tag 6 – 10: unverändert.
- UI / Frontend: keine Änderung nötig; `weather_data` hat lediglich neue optionale Felder (`nowcast`, `observed_now`, `confidence`).

## Test- / Verifikations-Plan

1. `generateForecast` manuell auslösen, `weather_data.nowcast` und `confidence` im DB-Eintrag prüfen.
2. Vergleich der ersten 6 h gegen die SMN-Live-Werte (Plausibilität: Δ T ≤ 1.5 °C, Bewölkungsrichtung korrekt).
3. Edge-Case "klare windstille Nacht": tmin sollte unter Modell-tmin liegen.
4. Edge-Case "Modell sieht 0 mm, Radar zeigt aktuell Regen": precip 0 – 2 h muss > 0 sein, Konfidenz "niedrig".

Nach Freigabe setze ich die Änderungen in dieser Reihenfolge um: Migration → `nowcast.server.ts` → Bias-Erweiterung → Integration in `forecast.functions.ts` → Verifikation.
