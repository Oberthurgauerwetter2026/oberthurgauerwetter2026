# Testbild mit synthetischen Werten

Da Open-Meteo bis 00:00 UTC gesperrt ist und keine echten Gitterwerte vorliegen, rendere ich ein **Demo-Bild mit synthetischen, aber realistisch wirkenden Druck-/T850-/Niederschlag-Feldern** (1 Hoch über Mitteleuropa, 1 Tief über dem Nordatlantik), damit die Styling-Änderungen geprüft werden können.

## Vorgehen

1. Kleines Node-Skript `/tmp/render-pressure-test.ts` schreiben, das `buildSvg` aus `src/server/pressure-map.server.ts` importiert. Dafür `buildSvg` und Typ `Grids` temporär exportieren (rein additiv, kein Verhaltens­wechsel).
2. Synthetische Grids erzeugen:
   - Druck (MSL): Basis 1013 hPa + Gauss-„Hoch" 1030 hPa über Alpen + Gauss-„Tief" 985 hPa über Island.
   - T850: linearer Süd-Nord-Gradient von +15 °C bis −20 °C, leicht moduliert.
   - Niederschlag: schmales Frontband entlang Tiefachse, Spitze 12 mm/6 h.
3. SVG generieren, nach `/mnt/documents/europe-pressure-demo.svg` schreiben und als Artifact ausliefern.
4. Visuell prüfen: Landfarbe `#D3EAC2`, H/T grösser, Niederschlag-Legende und Quellenangabe ohne Überlappung.

## Hinweis

Daten sind **frei erfunden** und dienen nur der Layout-/Styling-Kontrolle. Die echte Tageskarte folgt automatisch nach Reset des Open-Meteo-Limits (00:00 UTC).

## Geänderte Dateien
- `src/server/pressure-map.server.ts` (nur `export buildSvg` und Typ-Export hinzufügen)
- `/tmp/render-pressure-test.ts` (Hilfsskript, kein Repo-Commit)
