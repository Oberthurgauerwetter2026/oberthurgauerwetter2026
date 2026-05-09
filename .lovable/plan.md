## Änderung

In `src/server/pressure-map.server.ts` die Isobaren-Linien einheitlich schwarz statt blau/rot/grau zeichnen.

- Linienfarbe für **alle** Isobaren → `#000` (schwarz).
- Beschriftungen ebenfalls schwarz, weiterhin mit weisser Halo-Stroke für Lesbarkeit.
- Linienstärke-Staffelung bleibt: Hauptisobaren (alle 20 hPa) fett 1.6 px, Zwischenlinien dünn 0.9 px.
- H/T-Symbole und Druck-Farbflächen bleiben unverändert farbig.
