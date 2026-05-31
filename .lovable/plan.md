## Ziel
Die generierte Bodendruckkarte (SVG) erhält zwei optische Anpassungen:

1. Schriftart auf SF Pro (Apple-System-Font-Stack) geändert
2. Blaue Umrandung (Rahmen um den Plot-Bereich) entfernt

## Betroffene Dateien
Die Änderungen müssen in **beiden** SVG-Generatoren identisch erfolgen, damit sowohl der GitHub-Action-Workflow als auch der Cloudflare-Worker-Fallback das gleiche Ergebnis produzieren:

- `pressure-map-generator/generate.mjs`
- `src/server/pressure-map.server.ts`

## Durchführung

### 1. Schriftart (SF Pro)
- Alle Vorkommen von `font-family="Helvetica,Arial,sans-serif"` und `font-family="Georgia,serif"` im `buildSvg`-Output ersetzen durch einen SF Pro System-Font-Stack:
  ```
  -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif
  ```
- Betroffene Text-Elemente: Titel, Untertitel, Isobaren-Beschriftungen, H/L-Extrema-Werte und -Namen, Legendenbeschriftungen, Quellenzeile.

### 2. Blaue Umrandung entfernen
- Das Rahmen-`<rect>` um den Plot-Bereich (`stroke="#2561a1"`, `stroke-width="1.5"`) entfernen.
- In `generate.mjs` Zeile 415 und in `pressure-map.server.ts` Zeile 706.
- Der blaue Hintergrund (`<rect width="…" height="…" fill="#2561a1"" />`) bleibt unverändert — es geht nur um den sichtbaren Rahmenstroke.

## Erwartetes Ergebnis
- Beide Generatoren erzeugen SVGs mit durchgängigem SF Pro Font-Stack.
- Kein blauer 1,5 px Rahmen mehr um die eigentliche Kartenfläche.
- Keine funktionalen Änderungen an Daten, Farben oder Isobaren.
