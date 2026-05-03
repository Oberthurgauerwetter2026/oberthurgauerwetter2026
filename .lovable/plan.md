## Ziel

Reale Bewölkung von SwissMetNet (SMN) parsen und in die bestehende Bias-Korrektur aufnehmen, damit Modell-Bewölkung gegen Realität abgeglichen wird – analog zu Temperatur, Wind und Niederschlag.

## Änderungen

### 1. `src/server/swissmetnet.server.ts` — Bewölkung mitparsen
- Spalte `nto000d0` (Gesamtbedeckung in Achteln 0–8) lesen.
- In `SmnHourly["rows"]` neues Feld `cloud_pct: number | null` ergänzen (Achtel × 12.5, gerundet auf ganze %).
- Werte > 8 (z. B. 9 = nicht bestimmbar) → `null`.

### 2. `src/server/bias-correction.server.ts` — Cloud-Bias berechnen
- `fetchModelHistory` zusätzlich `cloudcover` (hourly) anfordern und im Rückgabeobjekt als `c: number | null` führen.
- `pairHourly` um `obs_c` / `mod_c` erweitern.
- `BiasResult` um `delta_cloud: number` ergänzen (additiv, %, geclampt ±30, Stärke-skaliert).
- `applyBiasToDay`:
  - `cloudcover` (avg/min/max) additiv um `delta_cloud` verschieben, hart auf 0–100 clampen.
  - Nur anwenden, wenn `cloudcover_source === "model"` (nicht überschreiben, wenn aus Sonnenscheindauer abgeleitet).
- `bias_correction`-Metadata um `delta_cloud` erweitern.

### 3. Konsistenz / UI
- `forecast.functions.ts` & `forecast.auto.ts`: keine Logikänderung nötig — `applyBiasToDay` wird bereits aufgerufen. Lediglich der Prompt-Hinweis (`windowHint` / Bias-Block) bekommt einen Satz: „Bewölkung ist mit SMN-Beobachtungen kalibriert (Δ Wolken: X %)".
- Kein DB-Schema-Change, keine neuen Secrets.

## Technische Details

- Halbwertszeit der Gewichtung (~2 Tage) bleibt identisch.
- Formel: `delta_cloud = clamp(weighted(obs_c - mod_c) * strength, -30, +30)`.
- Cache-Key der Bias-Berechnung muss invalidiert werden — durch Erweiterung der Modellabfrage-URL (neuer Parameter `cloudcover`) bekommt `om:hist:*` automatisch frische Daten beim nächsten Lauf; alter Cache läuft in 1 h regulär aus.

## Out of Scope (für später)

- Echtzeit-Nowcast-Anker für die ersten 1–3 h.
- UI-Vergleichszeile „Modell vs. SMN letzte 24 h".
- Cloud-Faktor multiplikativ (additiv ist für Bewölkung in % robuster).
