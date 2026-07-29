# Bodendruckkarte: organische statt würfelartige Formen

## Ursache (verifiziert)

Die Karte arbeitet auf einem sehr groben Gitter: `STEP = 2.0°` über -25…45° / 30…70° → nur 36 × 21 Gitterpunkte (`pressure-map-generator/generate.mjs`, Zeilen 34–38). `d3-contour` erzeugt darauf Konturen, die exakt auf Zellkanten laufen — also Treppen- und Kästchenformen. Beim Niederschlag ist es am schlimmsten: er wird nur mit **einem** Glättungsdurchlauf verarbeitet (`fillAndSmooth(raw.precip, 0, 1)`), und da Regenfelder fast binär sind, entstehen einzelne quadratische Blöcke pro Gitterzelle. Die vorhandene Nachbearbeitung (2× Chaikin + Catmull-Rom in `contourToPath`) rundet nur Ecken ab, kann aber die Kästchen-Struktur nicht auflösen.

## Lösung

Nicht die Kontur nachträglich runden, sondern **vor** dem Contouring das Feld verfeinern.

1. **Bikubisches Upsampling** (neue Funktion `resample(grid, factor)` in `generate.mjs`): jedes Feld vor `d3contours()` um Faktor 4–6 auf ein feines Gitter interpolieren (Catmull-Rom-Interpolation in beide Achsen). Aus 36 × 21 wird z. B. 141 × 81. `gridToPixel` bekommt einen Schrittparameter, damit die feinen Gitterkoordinaten korrekt projiziert werden.
2. **Glättung anpassen**: Niederschlag mit mehr Durchläufen (1 → 2 vor dem Upsampling, 1 weiterer nach dem Upsampling), Druck- und T850-Feld nach dem Upsampling je ein leichter Durchlauf. Ergebnis: weiche, natürlich auslaufende Ränder.
3. **Kurvenglättung feinjustieren**: Chaikin-Iterationen von 2 auf 3 für Flächen (Niederschlag, T850), bei Isobaren bei 2 belassen, damit die Linien nicht ihre Lage verlieren.
4. **Winzige Fragmente entfernen**: Ringe unterhalb einer Mindestfläche (ca. 25 px²) verwerfen, damit keine losen Ein-Zellen-Quadrate stehen bleiben.
5. **Extrema-Erkennung** (`findExtrema`) weiterhin auf dem **groben** Originalgitter laufen lassen — H/T-Positionen und die FU-Berlin-Namen bleiben damit unverändert.
6. Denselben Ablauf in `src/server/pressure-map.server.ts` (Worker-Fallback) spiegeln, damit beide Renderer identisch aussehen.

## Prüfung

SVG lokal über den vorhandenen Test-Harness rendern, per Playwright als PNG aufnehmen und visuell kontrollieren: keine rechteckigen Blöcke mehr, Isobaren durchgehend rund, H/T-Namen unverändert. Danach den GitHub-Workflow „Generate pressure map“ einmal manuell auslösen.

## Technische Details

- Neue Helfer: `resample(grid, factor)`, `ringArea(pts)`; `gridToPixel(gx, gy, step)`.
- Laufzeit/Größe: das feinere Gitter erhöht nur die Rechenzeit im Renderer (keine zusätzlichen Open-Meteo-Abfragen); die SVG-Größe steigt moderat, wird durch das Verwerfen von Kleinstringen aber teilweise wieder ausgeglichen.
