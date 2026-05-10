## Änderungen an `src/server/pressure-map.server.ts`

### 1. Landfläche umfärben
Zeile 538: `fill="#e8e0c8"` → `fill="#D3EAC2"`.

### 2. Fronten aus T850-Gradient ableiten und einzeichnen

Synoptische Fronten lassen sich gut aus dem horizontalen Temperaturgradienten der 850-hPa-Schicht (`t850`) berechnen. Vorgehen:

**a) Gradientenberechnung**
- Pro Gitterzelle Gradient von `t850` (zentrale Differenzen in x/y) → Magnitude `|∇T|` (°C/Gitterzelle).
- Schwellwert (z.B. `|∇T| ≥ 2.5 °C/cell`) markiert Frontalzonen.

**b) Linienzug extrahieren**
- Auf Gradient-Magnitude-Feld d3-contour mit einer Schwelle laufen lassen → Polygone, deren Ringe als Mittellinien der Frontalzone dienen.
- Alternativ einfacher: Iso-Linie der Temperatur-Laplace-Nullstelle → für unsere Auflösung (1.5°) reicht die Gradient-Schwelle.

**c) Klassifikation Kalt/Warm**
- Pro Frontsegment Bewegungsrichtung approximieren über die Komponente des Temperatur-Gradienten relativ zur (geostrophischen) Strömung. Vereinfachung ohne Wind-Daten:
  - Kaltfront: kalte Luft schiebt nach Süden/Osten → Segment liegt am Westrand eines warmen Bereichs (∂T/∂x > 0 bei Bewegung E).
  - Warmfront: warme Luft schiebt nach Norden/Osten → Segment liegt am Ostrand eines kalten Bereichs.
- Praktikabel: Gradientenrichtung `arg(∇T)` betrachten:
  - Wenn Gradient nach Süd-Ost zeigt (Kaltluft kommt aus NW) → Kaltfront (blau).
  - Wenn Gradient nach Süd-West zeigt (Warmluft kommt aus SW) → Warmfront (rot).

**d) Zeichnen**
- Glatte Pfade mit bestehendem `chaikin` + Catmull-Rom.
- Kaltfront: blaue Linie `#1d4ed8`, dazu kleine ausgefüllte Dreiecke entlang der Linie auf der Bewegungsseite.
- Warmfront: rote Linie `#dc2626`, dazu kleine Halbkreise entlang der Linie auf der Bewegungsseite.
- Symbol-Spacing alle ~25–35 px, ausgerichtet an Tangente des Pfads.

**e) Render-Reihenfolge**
- Fronten werden NACH Isobaren, ABER ÜBER T850-Flächen gezeichnet (eigene `<g>` Gruppe, mit `clip-path="url(#plot)"`).
- Legende um zwei Einträge ergänzen: „Kaltfront" / „Warmfront".

### Risiken / Einschränkungen
- Ohne Wind-Daten ist die Front-Klassifikation eine Heuristik. Resultat ist „synoptisch plausibel", entspricht aber nicht zwingend einer DWD-Frontenanalyse.
- Bei flacher Temperaturverteilung bleiben evtl. keine Fronten — das ist meteorologisch korrekt.
- Keine zusätzlichen API-Calls nötig (T850 wird bereits geladen).

Keine weiteren Dateien betroffen.