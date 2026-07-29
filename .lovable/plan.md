## Problem

Die Karte wird derzeit optisch geglättet, indem das grobe Datengitter künstlich verfeinert wird:

- Datenabruf erfolgt auf einem 2.0°-Gitter (`STEP = 2.0` in `pressure-map-generator/generate.mjs`, gespiegelt in `src/server/pressure-map.server.ts`).
- Danach wird bikubisch auf das 4-fache hochgerechnet (`resample(..., 4)`) und zusätzlich mit einem 3x3-Boxblur (`smooth()`) geglättet — beim Niederschlag sogar zweimal.

Damit werden echte Messwerte verändert: Druckminima werden abgeflacht, Niederschlagsspitzen verschmiert, Isobaren verschoben. Die Karte sieht organisch aus, entspricht aber nicht mehr exakt den tatsächlichen Bedingungen.

## Ziel

Die Karte muss die tatsächlichen Modelldaten korrekt wiedergeben — die Glättung darf nur aus **mehr echten Daten** entstehen, nicht aus erfundenen Zwischenwerten.

## Vorgehen

1. **Echte Auflösung erhöhen**
   - Gitter von 2.0° auf 1.0° verfeinern (ca. 61 x 31 = 1891 Punkte statt aktuell rund 500).
   - Batch-Abruf bleibt bei 200 Punkten pro Request, also ca. 10 statt 4 Open-Meteo-Calls; bestehende Retry-/Proxy-Logik wird weiterverwendet.
   - ICON-EU liefert nativ rund 0.0625°, ICON-D2 noch feiner — 1.0° ist also echte, keine erfundene Information.

2. **Künstliche Werteveränderung entfernen**
   - Boxblur (`smooth()`) auf Druck und Temperatur entfällt; Werte bleiben unverändert.
   - Beim Niederschlag maximal eine sehr leichte Glättung, damit einzelne Zellenspitzen keine Nadeln erzeugen — Schwellenwerte der Legende bleiben aussagekräftig.
   - `resample()` wird nur noch als geometrische Zwischenstufe (Faktor 2 statt 4) genutzt, damit Kontursegmente nicht der Gitterkante folgen; die Stützwerte des Originalgitters bleiben dabei exakt erhalten (Catmull-Rom läuft durch die Originalpunkte).

3. **Glättung nur noch in der Geometrie**
   - Chaikin-Rundung und Dezimierung bleiben, aber schwächer dosiert, damit Fronten- und Isobarenverläufe nicht verwaschen.
   - Hoch-/Tiefzentren werden weiterhin auf dem Originalgitter bestimmt, damit Position und hPa-Wert exakt bleiben; FU-Berlin-Namen bleiben unverändert.

4. **Kontrolle**
   - Vergleich der Extremwerte (min/max Druck, max Niederschlag) vor und nach dem Rendering: Abweichung muss 0 sein.
   - Test-Render mit echten Daten und visuelle Prüfung: keine kästchenartigen Strukturen, aber Isobaren, die den realen Werten folgen.
   - Dateigrösse und Laufzeit prüfen (Ziel: SVG unter ca. 2 MB, Action-Laufzeit im bisherigen Rahmen).

5. **Beide Renderer synchron halten**
   - Identische Änderungen in `pressure-map-generator/generate.mjs` (GitHub Action) und `src/server/pressure-map.server.ts` (Fallback im Backend).

## Technische Details

- Betroffene Dateien: `pressure-map-generator/generate.mjs`, `src/server/pressure-map.server.ts`
- Keine Änderungen an Datenbank, Storage-Pfaden oder Einbettungs-URL — die Karte bleibt unter derselben öffentlichen Adresse abrufbar.
- Mehr Abrufpunkte bedeuten etwas längere Laufzeit der GitHub Action (geschätzt +20-40 s), aber keine zusätzlichen Kosten.
