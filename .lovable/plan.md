# Ensemble-Layer: ICON-CH1-EPS & ICON-CH2-EPS als Vertrauens-Schicht

## Ziel

Die deterministischen Modelle (`meteoswiss_icon_ch1`, `meteoswiss_icon_ch2`, AROME, ECMWF, GFS) bleiben unverändert das Rückgrat des Forecasts. Zusätzlich wird ein **Ensemble-Layer** eingezogen, der pro Tag und Parameter (Tmax, Tmin, Niederschlag, Wind) **Streuung und Wahrscheinlichkeiten** liefert. Diese Information wird:

1. intern zur **Gewichtung von Ausreissern** im bestehenden Ensemble-Mix verwendet,
2. in der UI als **Vertrauens-Badge** und **Wahrscheinlichkeiten** angezeigt.

Es werden keine bestehenden Modelle entfernt.

## Was der Nutzer sehen wird

Pro Forecast-Tag auf der Forecast-Karte ein zusätzliches kleines Element:

- Badge "Sicherheit: hoch / mittel / tief" basierend auf EPS-Spread bei Tmax
- Optional: "70% Wahrscheinlichkeit > 5mm Niederschlag" statt nur eines Mittelwerts
- In der Detail-Ansicht: Min/Max-Bandbreite der 21 Member als feine Linie um den Forecast-Wert

Keine bestehenden Werte ändern sich optisch dramatisch — der Layer ist additiv.

## Technische Umsetzung

### 1. Neuer Server-Modul `src/server/ensemble.server.ts`

- Holt Daten vom Open-Meteo **Ensemble-Endpoint** `/v1/ensemble` (anderer Endpoint als `/v1/forecast`)
- Modelle: `icon_seamless` als CH1-EPS + CH2-EPS Kombination (Open-Meteo bündelt MeteoSwiss EPS unter eigenen Keys — beim Implementieren verifizieren, ggf. `icon_d2_eps` als Fallback)
- Parameter: `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `wind_speed_10m_max`
- Cache: 6h (analog Druckkarte-Logik), Key pro Standort + Tag
- Output pro Tag:
  ```ts
  {
    tmax: { mean, p10, p50, p90, spread }
    tmin: { ... }
    precip: { mean, p50, p90, prob_gt_1mm, prob_gt_5mm, prob_gt_10mm }
    wind:  { mean, p90, prob_gt_50kmh }
    members_count: number
  }
  ```
- Quota-Tracking analog `openmeteo-quota.server.ts` (eigene Source `ensemble`)

### 2. Integration in `forecast.functions.ts`

- Neue Funktion `mergeEnsembleConfidence(day, eps)` die das Tagesobjekt um ein Feld `confidence` ergänzt
- `confidence.level`: "high" wenn Tmax-Spread < 2°C, "medium" < 4°C, sonst "low"
- `confidence.precip_probabilities`: aus EPS übernommen
- **Ausreisser-Dämpfung**: Wenn ein deterministisches Modell mehr als 2·sigma vom EPS-Median abweicht, sein Gewicht im bestehenden Mix halbieren (sanft, nicht 0)

### 3. UI-Erweiterung in `WeatherDataView.tsx` / Forecast-Karte

- Kleines Badge oben rechts pro Tag: farbcodiert (grün/gelb/orange)
- Tooltip: "Basierend auf 21 ICON-CH2-EPS-Membern, Spread Tmax ±X°C"
- Niederschlags-Anzeige bekommt zusätzlich "P(>5mm): 70%" als sekundäre Zeile

### 4. Cron / Abruf-Frequenz

EPS läuft im normalen täglichen Forecast-Zyklus mit — kein separater Cron nötig. Pro Forecast-Generation 1 Ensemble-Call pro Hauptstandort.

## Kosten

- Open-Meteo zählt Ensemble-Anfragen höher (~Faktor 3–5 wegen Member-Anzahl) als normale Forecast-Calls
- Erwartet: bei 1× täglicher Forecast-Generation für ~3 Standorte: ~50–100 Call-Units/Tag zusätzlich
- Bleibt innerhalb des Free-Tier-Budgets (10'000/Tag)
- Quota-Card im Admin zeigt die neue Source `ensemble` separat

## Out of Scope (bewusst nicht in diesem Plan)

- Komplette Umstellung auf EPS-only (würde Forecast-Schärfe kosten — siehe vorherige Diskussion)
- Eigene EPS-Visualisierung (Plume-Diagramme etc.) — erstmal nur Badges + Wahrscheinlichkeiten
- Anwendung auf den KI-Wetterbericht-Text (kann später ergänzt werden, sobald der Layer steht)

## Risiken / zu verifizieren

- **Open-Meteo Ensemble-Modell-Keys für MeteoSwiss EPS**: Beim Implementieren prüfen, ob `meteoswiss_icon_ch1_eps` / `meteoswiss_icon_ch2_eps` als eigene Modelle verfügbar sind oder ob sie nur via `icon_seamless` im Ensemble-Endpoint kommen. Fallback: `icon_d2_eps` (DWD, deckt CH gut ab).
- **Cache-Konsistenz**: EPS-Cache und Forecast-Cache müssen denselben Lauf-Zeitstempel teilen, sonst gibt's Versatz zwischen Badge und Werten.
