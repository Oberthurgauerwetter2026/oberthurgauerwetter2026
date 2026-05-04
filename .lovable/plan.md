## Ziel

ECMWF AIFS (KI-Wettermodell) ergänzend einbinden — nicht nur in der Modell-Liste mitgemittelt, sondern als **separater Vergleichs-Layer**, damit die KI-Textgenerierung Abweichungen zwischen klassischen Modellen und AIFS explizit benennen kann.

## Konzept

Open-Meteo unterstützt das Modell `ecmwf_aifs025_single`. Ein zusätzlicher, separater Open-Meteo-Call holt **nur** AIFS-Daten für Tag 1–10. Aus diesen Daten wird pro Tag ein kompakter Vergleich gegen den bestehenden Multi-Modell-Mittelwert berechnet (Tmax/Tmin/Niederschlag/Wind) und als Zusatz-Block in den User-Prompt eingespeist. Tagesprognosen Tag 1–5 und Trend Tag 6–10 erhalten den jeweils passenden AIFS-Block.

## Änderungen in `src/server/forecast.functions.ts`

### 1. Neue Hilfsfunktion `fetchAifsTimeline` (ca. 40 Zeilen, neu nach `fetchOpenMeteoOptional`)

Einzelner Open-Meteo-Call mit `models=ecmwf_aifs025_single`, gleiche `DAILY_VARS` wie sonst, `forecast_days=11`. Verwendet `getOrSetCache` mit Key `om:aifs:{lat},{lon}` (Cache bis Mitternacht, wie mid/long). Bei 429/Fehler: `null` zurückgeben (AIFS ist optional, darf den Forecast nie blockieren).

### 2. AIFS-Fetch in `fetchWeather` integrieren

Nach den drei bestehenden Tier-Calls (short/mid/long) zusätzlich AIFS sequenziell holen (`await wait(500)` davor, gleiche Rate-Limit-Hygiene). Ergebnis als `weather.byModel.aifs` und `weather.modelLists.aifs = "ecmwf_aifs025_single"` ablegen. **Nicht** in `pickBestSource` / `collectModelValuesTiered` einbinden — AIFS bleibt bewusst aus dem Multi-Modell-Mittelwert raus, damit der Vergleich aussagekräftig bleibt.

### 3. Neue Hilfsfunktion `formatAifsComparison(weather, dayIndex)` (ca. 40 Zeilen)

Liest die AIFS-Werte für den Tag (`temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `windspeed_10m_max`, `cloudcover_mean`) und vergleicht gegen den klassischen Mittelwert aus `formatDayData`. Liefert ein kompaktes Objekt:
```
{ tmax_aifs, tmax_classic, delta_tmax,
  precip_aifs, precip_classic, delta_precip,
  wind_max_aifs, wind_max_classic,
  significant: boolean }
```
`significant = true` wenn |Δtmax| ≥ 1.5 °C ODER |Δprecip| ≥ 2 mm ODER Niederschlagskategorie wechselt (trocken ↔ Niederschlag).

### 4. Trend-Block-Vergleich `formatAifsTrendComparison(weather, dayIndices[])`

Aggregiert AIFS-Werte über Tag 6–10 (Mittel) und vergleicht gegen Multi-Modell-Aggregat. Liefert nur Tendenz-Aussage (z. B. "AIFS milder/kühler", "AIFS feuchter/trockener"), keine Tageswerte — passt zum Grosswetterlagen-Charakter des Trend-Blocks.

### 5. AIFS-Block in User-Prompts einspeisen

**Tagesprognosen (Zeile ~1378 in `generateForecast`, ~1505 in `regenerateForecast`, sowie `regenerateEntry`):**
```
Standort: ${locationName}. Schreibe einen Fliesstext für ...
${aifsBlock ? `\n\nKI-Modell-Vergleich (ECMWF AIFS): ${aifsBlock}` : ""}
Daten: ...
```
`aifsBlock` wird nur eingefügt, wenn `formatAifsComparison(...).significant === true`. Sonst bleibt der Prompt unverändert (kein Rauschen bei Übereinstimmung).

**Trend-Block (Zeile ~1388 / ~1515):**
Der `formatAifsTrendComparison`-Output wird **immer** angehängt (auch ohne Signifikanz), als Tendenz-Hinweis für die Grosswetterlage.

### 6. System-Prompt-Erweiterung (im `promptTemplate`)

Kurzer neuer Absatz im System-Prompt:
> "Wenn ein Block 'KI-Modell-Vergleich (ECMWF AIFS)' vorhanden ist: Erwähne die Abweichung dezent als Unsicherheit (z. B. 'mehrheitlich trocken, KI-Modell deutet leichtes Schauerrisiko an'). Niemals AIFS gegen die klassischen Modelle ausspielen — die klassische Multi-Modell-Lösung bleibt Leitlinie."

### 7. Settings-Defaults

`models_midterm` und `models_longterm` in `app_settings`-Defaults bleiben **unverändert** — AIFS ist bewusst ein separater Layer, kein Mittelwert-Bestandteil. Keine DB-Migration nötig.

## Quota-Auswirkung

- **+1 Open-Meteo-Call pro Generierung** (gecacht bis Mitternacht, also faktisch +1 Call/Tag bei mehrfacher Generierung).
- AIFS-Fehler/429 → `null` → kein AIFS-Block, Forecast funktioniert normal weiter.
- Im `degraded`-Modus (MOSMIX-only) wird AIFS gar nicht erst versucht.

## Nicht geändert

- Multi-Modell-Mittelwert, `formatDayData`, MOSMIX, Bias-Korrektur, Radar — alles unberührt.
- Nominalstil-Validator, Sky-Consistency, `enforceSkyConsistency` — unberührt.
- DB-Schema, RLS, Auth — unberührt.
- Kein neues Settings-UI nötig (kann später ergänzt werden, wenn AIFS-Block ein-/ausschaltbar sein soll).

## Dateien

- `src/server/forecast.functions.ts` — neue Helfer + Integration in `fetchWeather`, `generateForecast`, `regenerateForecast`, `regenerateEntry`, System-Prompt.

## Optional (später)

- Settings-Toggle "KI-Modell-Vergleich aktivieren" in `app_settings` + Settings-UI.
- AIFS auch in `bias-correction.server.ts` aufnehmen (separate Bias-Korrektur).
- UI-Anzeige: kleines Badge im Forecast-Detail "AIFS weicht ab".
