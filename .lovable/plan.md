## Ziel

Druckkarte um zwei Layer erweitern, beide als Overlay auf der bestehenden Karte:

1. **Temperatur 850 hPa** — als farbige Hintergrundfläche (warme Töne = Warmluft, kalte Töne = Kaltluft). Ersetzt den aktuellen pastelligen Druckfarbverlauf, wodurch indirekt **Warm- und Kaltluftadvektion** sichtbar wird (Druckgradient + Temperaturgradient = "Pseudo-Frontenbild").
2. **Niederschlagsvorhersage** (6 h-Summe um den Zielzeitpunkt) — als halbtransparente blaue Schraffur/Fläche über der Temperatur, unter den Isobaren.

Die bestehenden **Isobaren (5 hPa)** und **H/L-Marker** bleiben oben drauf — sie sind die wichtigste Information.

## Layer-Reihenfolge (von hinten nach vorn)

```text
1. Hintergrund #2561a1
2. Küstenlinien / Seen
3. T850-Farbflächen          (neu, ersetzt Druck-Farbverlauf)
4. Niederschlag-Overlay       (neu, halbtransparent)
5. Isobaren + Beschriftung
6. H/L-Symbole
7. Legende (zwei Farbskalen: T850 °C, Niederschlag mm)
```

## Datenquelle

Alles aus **Open-Meteo `icon_seamless`** in einem Request pro Batch (gleiche Pipeline wie heute), zusätzliche Variablen:

- `temperature_850hPa` (°C)
- `precipitation` (mm/h, summiert über 6 h um den Zielzeitpunkt)

Kein neuer Provider, keine zusätzlichen Secrets.

## Farbskalen

- **T850**: −30 °C (tiefblau) → 0 °C (weiß) → +25 °C (dunkelrot), Stufen alle 2 °C.
- **Niederschlag**: 0,5 / 1 / 2 / 5 / 10 / 20 mm/6h, transparente Blautöne (sichtbar über T850).

## UI / Legende

- Aktualisierter Untertitel: *„DWD ICON-EU · T850 °C · Niederschlag 6 h · Isobaren je 5 hPa"*
- Zwei kompakte Farbleisten unten (T850 links, Niederschlag rechts).

## Was nicht geändert wird

- Cron-Schedule, Endpoint, Storage-Pfad, manueller Button.
- Karten-Extent, Auflösung, H/L-Erkennung.

## Hinweis zu „echten" Fronten

Echte Warm-/Kaltfront-Symbole (Halbkreise/Dreiecke entlang Linien) gibt es nicht als offene Vektor-Daten. Das hier ist die saubere meteorologische Alternative: T850-Gradient zeigt Frontalzonen klar erkennbar.
