## Einmaliges Testbild ohne Code-Änderungen

Ich rendere die Karte einmalig **außerhalb der App** mit synthetischen Daten und liefere dir das fertige SVG als Download. Keine Änderung am Projekt, kein neuer Endpoint, kein Button.

### Schritte

1. Standalone-Skript in `/tmp/render-test-pressure-map.ts` schreiben, das die reinen Render-Funktionen aus `src/server/pressure-map.server.ts` (buildSvg + Helper) nutzt — die Open-Meteo- und Supabase-Aufrufe werden gestubbt, sodass keine API/DB benötigt wird.
2. Synthetische `Grids` erzeugen:
   - Druck: Azoren-Hoch + Island-Tief + Skandinavien-Tief (Gauß-Glocken um 1013 hPa).
   - T850: kräftiger N–S-Gradient mit welligen Frontalzonen, damit die Front-Heuristik ausgelöst wird.
   - Niederschlag: zwei Bänder entlang der Frontalzonen.
3. SVG schreiben nach `/mnt/documents/pressure-map-test.svg` und dir als Artefakt liefern.

Du kannst es direkt im Browser öffnen oder herunterladen. Sobald das Open-Meteo-Limit morgen wieder frei ist (nach 00:00 UTC), läuft die echte tägliche Generierung wieder normal.