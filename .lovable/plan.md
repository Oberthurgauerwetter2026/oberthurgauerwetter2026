## Problem

Im Sonntagseintrag (Tag 2) steht "Am Morgen und Vormittag … zeitweise Regen", obwohl die Modelle den Niederschlag auf Nachmittag/Abend legen.

Ursache: `precip_distribution` und `hourly_profile` werden in `formatDayData` (`src/server/forecast.functions.ts`, Zeile 1615/1616) **nur für `dayIndex <= 1`** erzeugt. Zusätzlich liefert `fetchWeather` Stundenwerte ausschliesslich aus dem Short-Tier (Zeile 763 — Tag 0/1 CH-Modelle). Ab Tag 2 sieht die KI also nur eine Tagessumme (3.9 mm) und rät die Tageszeit — aktuell falsch.

## Ziel

Die KI soll für Tag 2 bis Tag 4 wissen, **wann** am Tag der Regen fällt, statt zu raten.

## Änderungen (nur `src/server/forecast.functions.ts`)

1. **Mid-Tier Hourly aktivieren**
   - In `fetchWeather` (Zeile 742–745) den Mid-Tier-Call mit `includeHourly: true` ausführen.
   - Cache-Key um `:h` ergänzen, damit der bestehende Daily-only-Cache nicht kollidiert.
   - Result-Mapping: `hourly` aus Short-Tier behalten (feinste Auflösung); zusätzlich `hourly_mid` aus `midData?.hourly` durchreichen.

2. **Hourly-Quelle pro Tag wählen**
   - Neue Hilfsfunktion `pickHourly(weather, dayIndex)`: Tag 0/1 → `weather.hourly` (Short, CH-Modelle), Tag 2–4 → `weather.hourly_mid` (ICON-CH2/D2/IFS/ARPEGE/GFS), darüber hinaus → null.
   - `computePrecipDistribution`, `buildHourlyProfile`, `assessThunderstormRisk`, `assessGusts`, `detectFogDissipation` so aufrufen, dass sie das passende `hourly`-Objekt sehen (kleine Wrapper-Variante oder Parameter `hourlySource`).

3. **`formatDayData` erweitern (Zeile 1615–1625)**
   - `precip_distribution` für `dayIndex <= 4` berechnen, sofern die gewählte Hourly-Quelle den Tag abdeckt; sonst null.
   - `hourly_profile` ebenfalls für `dayIndex <= 4` (cloud/sun-Raster bleibt für Tag 0/1 fein; für 2–4 reicht das Niederschlags-/Wolkenraster aus dem Mid-Tier).
   - `peak_hour`, `dry_windows`, `wet_hours` pro Block (existieren bereits in `computePrecipDistribution`) werden so automatisch in `weather_data` und in den Prompt mitgegeben.

4. **Prompt-Hinweis schärfen**
   - Im System-Prompt-Abschnitt zu Niederschlag eine Regel ergänzen: "Wenn `precip_distribution` vorhanden ist, beschreibe den Niederschlag chronologisch nach dem Block mit dem höchsten `precip_mm`/`max_prob`. Erfinde keine Tageszeit, wenn nur die Tagessumme vorliegt — dann 'im Tagesverlauf' / 'zeitweise' verwenden."

## Was wir nicht anfassen

- UI / `WeatherDataView` bleibt unverändert (das JSON ergänzt sich automatisch).
- Bias-Correction, Ensemble, Lightning-Off-Logik, Auto-Forecast-Cron unverändert.
- Long-Tier (Tag 5–10) bleibt ohne Hourly — dort soll die KI weiterhin generisch formulieren.
- Keine DB-Migration nötig.

## Validierung

- Forecast `8ddb31cf-…` neu generieren.
- In `weather_data` für Tag 2 (Sonntag) bis Tag 4 muss `precip_distribution` mit den vier Blöcken erscheinen; erwartet für Sonntag: `afternoon`/`evening` mit höherem `precip_mm` als `morning`.
- Sonntags-Body sollte dann z.B. lauten: "Am Vormittag stark bewölkt, weitgehend trocken. Am Nachmittag und Abend zeitweise Regen, vereinzelt Schauer."

## Risiken

- Open-Meteo-Quota: Der Mid-Tier-Call wird grösser (Hourly für 5 Modelle × 10 Tage). Mitigation: bestehender Tagescache greift bereits; zusätzlich `forecast_days` für Mid-Tier-Hourly optional auf 5 begrenzen.
