## Ziel

Die Isobaren sollen weicher und runder verlaufen, ohne Detail-Information zu verlieren.

## Änderungen in `src/server/pressure-map.server.ts`

1. **Stärkeres Grid-Smoothing vor dem Contouring**
   - Aktuell: 1 Pass `smooth(grid)`
   - Neu: 3 Passes (≙ Gauss-ähnliche Glättung), entfernt kleine numerische Wellen, die Knicke in den Linien erzeugen.

2. **Chaikin-Eckenglättung vor dem Bezier-Pfad**
   - Neue Helper-Funktion `chaikin(ring, iterations=2)`: ersetzt jede Kante durch zwei neue Punkte bei 25 % und 75 % → halbiert die Eckwinkel pro Iteration. Zwei Iterationen → spürbar runder.
   - Wird in `contourToPath()` auf jeden Ring angewendet, bevor die Catmull-Rom-Bezier-Kurve gebildet wird.

3. **Linien-Optik**
   - `stroke-linejoin="round"` und `stroke-linecap="round"` sind bereits gesetzt → bleibt.
   - Schwarz und Strichstärken bleiben unverändert.

## Trade-off

Mehr Glättung kostet ein wenig Rechenzeit (vernachlässigbar, < 50 ms zusätzlich) und verschiebt H/T-Positionen um max. 1 Pixel — synoptisch irrelevant.
