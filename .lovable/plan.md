## Ziel
Der breite blaue Rand rund um die eigentliche Karte (Bereich mit Titel „Bodendruck Europa", Untertitel, Legenden, Quellenzeile) soll verschwinden. Dieser Rand entsteht durch das blaue Hintergrund-Rect `fill="#2561a1"`, das die gesamte SVG-Fläche füllt.

## Änderungen (in beiden Generatoren identisch)

**Dateien**
- `pressure-map-generator/generate.mjs` (Zeile 399)
- `src/server/pressure-map.server.ts` (Zeile 676)

**1. Hintergrundfarbe auf Weiß**
```
<rect width="${IMG_W}" height="${IMG_H}" fill="#ffffff" />
```
Damit verschwindet der blaue Außenrand komplett. Der Ozean bleibt blau, weil er innerhalb des Plot-Bereichs separat über `<rect ... fill="#a8c8e0" />` plus `oceanPath fill="#7fb0d4"` gezeichnet wird.

**2. Textfarben anpassen** (sonst auf Weiß unsichtbar)
- Titel (Zeile 400 / 677): `fill="#ffffff"` → `fill="#0f172a"`
- Untertitel (Zeile 401 / 678): `fill="#cbd5e1"` → `fill="#475569"`
- Legenden-Labels „Temperatur 850 hPa (°C)" und „Niederschlag 6 h (mm)" (Zeile 418/421 bzw. 711/716): `fill="#ffffff"` → `fill="#0f172a"`
- Legenden-Swatch-Labels (Zeile 392 in `generate.mjs` und Pendant in `pressure-map.server.ts`): `fill="#ffffff"` → `fill="#334155"`
- Quellenzeile bleibt `#94a3b8` (auf Weiß noch lesbar) — unverändert.

## Ergebnis
- Karte sitzt auf weißem Hintergrund, ohne blauen Rahmenbereich um den Titel/Legenden.
- Innerhalb der Plot-Fläche bleiben Meer, Land, Isobaren, Niederschlag, Temperatur unverändert.
- Alle Texte sind auf dem neuen weißen Hintergrund kontraststark lesbar.
- Beim nächsten GitHub-Action-Lauf (alle 6 h oder via `FORCE_REGENERATE`) wird die neue Karte generiert; der Worker-Fallback liefert dasselbe Bild.
