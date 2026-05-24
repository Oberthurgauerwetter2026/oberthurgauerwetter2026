# Niederschlag-Farben in Bodendruckkarte ändern

## Ziel
Die Niederschlagsflächen sollen sich klar von den Temperaturfarben (T850, blau↔rot) abheben. Aktuell sind beide in ähnlichen Blautönen.

## Änderung
Nur eine Datei: `pressure-map-generator/generate.mjs`

### `precipStyle(mm)` (Zeile 284–292) — neue Palette Grün → Gelb → Magenta

| Schwelle (mm/6h) | Farbe | Opacity |
|---|---|---|
| < 0.5 | — (nicht gezeichnet) | — |
| 0.5–1 | `#a7f3a0` hellgrün | 0.50 |
| 1–2 | `#4ade80` grün | 0.60 |
| 2–5 | `#facc15` gelb | 0.70 |
| 5–10 | `#fb923c` orange | 0.78 |
| 10–20 | `#ef4444` rot/magenta-rot | 0.82 |
| ≥ 20 | `#a21caf` magenta/violett | 0.88 |

Die warmen Werte (gelb/orange/rot) liegen zwar in der Temperatur-Spannweite, **werden aber über die roten T850-Flächen gelegt** — durch die hohen Opacities (≥ 0.7) bleibt der Niederschlag dort klar als eigene Information lesbar, und im häufigsten Fall (kaltes, nasses Wetter mit blauem T850) ist der Kontrast jetzt maximal (Grün auf Blau).

### Keine weiteren Änderungen
- Schwellen (`precipThresholds = [0.5, 1, 2, 5, 10, 20]`) bleiben.
- Legenden-Logik (`pSwatches`, Zeile 385) liest die Farben automatisch über `precipStyle(...)` — passt sich an.
- Isobaren, T850-Skala, Hoch/Tief-Marker bleiben unverändert.

## Resultat
Niederschlagsflächen sind sofort als „Radar-Schicht" erkennbar und kollidieren visuell nicht mehr mit den kalten T850-Flächen. Die Legende unten rechts aktualisiert sich automatisch.
