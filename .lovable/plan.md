## Ziel

Aus der reinen Linienkarte eine **professionell wirkende Wetterkarte** machen: farbige Druckverteilung, Hillshading-Relief im Hintergrund, glatte Isobaren, detaillierter Europa-Basemap.

## 1. Schönere Basemap

`src/data/europe-countries.json` (63 KB, stark vereinfacht) → ersetzen durch **Natural Earth 50 m** Mehrschicht-Set, vorab in `src/data/` abgelegt:

- `ne_50m_ocean.json` (Meerflächen, hellblau gefüllt)
- `ne_50m_land.json` (Landflächen, beige Grundton)
- `ne_50m_lakes.json` (Seen, hellblau)
- `ne_50m_rivers.json` (Flüsse, dünn blau)
- `ne_50m_admin_0_countries.json` (Ländergrenzen, dezent grau)
- `ne_50m_populated_places_simple.json` → Top-30 europäische Städte als Referenzpunkte

Alle vorab via Skript auf den Kartenausschnitt geclippt und auf 4 Dezimalstellen gerundet → Gesamtgrösse < 250 KB.

## 2. Relief (Hillshading)

Option, die im Cloudflare Worker funktioniert: **vorgerendertes Hillshade-PNG** (1200 × 800 px, ~80 KB) als statisches Asset in `src/assets/europe-hillshade.png`, in das SVG via `<image href="data:image/png;base64,…">` als unterste Ebene eingebettet, mit `opacity: 0.35` über die Landflächen.

- Generierung **einmalig** mit einem Node-Skript (`scripts/build-hillshade.mjs`, läuft lokal, nicht im Worker) aus Open-Meteo Elevation API oder ETOPO1-Daten → committed.
- Kein zusätzlicher Runtime-Cost, lädt offline.

## 3. Farbige Druckverteilung

Zusätzlich zu den Isobaren-Linien wird der Druckwert als **gefüllte Konturen** (`d3-contour` mit `thresholds(...)`) gerendert:

- Farbskala (oklch, in `src/styles.css` als Kommentar dokumentiert):
  - ≤ 990 hPa → kräftiges Blau
  - 1000 hPa → blasses Blau
  - 1013 hPa → neutralweiss
  - 1020 hPa → blasses Orange
  - ≥ 1035 hPa → kräftiges Rot
- Layer-Opacity 0.45, damit Hillshading + Grenzen sichtbar bleiben.
- Schritt 2 hPa für die Farbflächen (sanfter Gradient), Schritt 5 hPa für die Linien (synoptischer Standard).

## 4. Saubere Drucklinien

- d3-contour-Polygone werden **vor dem SVG-Pfad** mit einer einfachen Catmull-Rom-Glättung pro Liniensegment in eine kubische Bezier-Sequenz umgewandelt → keine Knickstellen mehr.
- 1 Smoothing-Pass auf dem Druck-Grid (statt 2), damit Details erhalten bleiben.
- Linienstärke gestaffelt:
  - 1020 hPa & 1000 hPa fett (1.8 px)
  - alle 5 hPa normal (1.0 px)
  - Beschriftungen mittig auf der Linie mit weisser Halo-Stroke (Lesbarkeit über Farbflächen).

## 5. H- / T-Symbole

- Grosse, halbtransparente weisse Kreisscheibe als Hintergrund.
- **H** in dunklem Rot, **T** in dunklem Blau, Bold, 28 px.
- Druckwert in 12 px darunter.

## 6. Layer-Reihenfolge im SVG

```text
1. Ozean-Polygon (hellblau)
2. Land-Polygon (beige)
3. Hillshade-Bild (multiply, opacity 0.35)
4. Seen + Flüsse
5. Druck-Farbflächen (opacity 0.45)
6. Ländergrenzen (dünn grau)
7. Isobaren-Linien + Beschriftungen
8. H/T-Symbole
9. Städte als kleine Punkte + Labels
10. Titel, Datum, Legende, Copyright-Hinweis
```

## 7. Was nicht geändert wird

- Datenquelle (DWD ICON-EU + Fallback) bleibt.
- Kartenausschnitt Europa.
- Output-Format SVG, gleiche Storage-URL → WordPress-Embed bricht nicht.
- Kein Wechsel zu Raster/PNG → Datei bleibt schlank.

## Risiken / Trade-offs

- Asset-Grösse SVG steigt von ~30 KB auf ~120 KB (Hillshade als data-URL), inkl. base64 ≈ 200 KB. Akzeptabel für eine täglich gecachte Karte.
- Erstes Generieren des Hillshade-Assets dauert ~5 Minuten lokal — wird einmalig committed.
- Bei extremen Druckwerten (< 970, > 1045) wird die Farbe geclamped (kein Datenverlust, nur visuell flach).
