# Bodendruckkarte – Anpassungen

## 1. Landfarbe
In `src/server/pressure-map.server.ts` (Zeile 538) `fill="#e8e0c8"` → `fill="#D3EAC2"`.

## 2. H und T grösser
In `buildSvg` (Zeilen 478–484): Symbol-Kreis `r=18 → r=22`, Buchstabe `font-size="26" → "34"`, Wert-Label `font-size="11" → "13"`, y-Offset `+28 → +34`.

(Falls aktuell „L" statt „T" gerendert wird, gleichzeitig auf „T" anpassen.)

## 3. Legenden Niederschlag und Quellenangabe nicht überlappen
T850- und Niederschlag-Legende sitzen auf `IMG_H - 30`, Quellenangabe auf `IMG_H - 10` – dadurch laufen Labels in die Quellenzeile.

Lösung: `IMG_H` 800 → 840 px und `PAD.bottom` 40 → 80 px erhöhen. Legenden bleiben am unteren Rand, Quellenangabe rückt darunter mit klarem Abstand. Plot-Bereich bleibt visuell identisch.

## 4. Einmaliger Download-Test (kein UI-Button)
Nach dem Code-Edit lade ich die generierte SVG einmalig per Tool von der öffentlichen Storage-URL herunter, lege sie in `/mnt/documents/europe-pressure-test.svg` ab und liefere sie als Artifact-Vorschau, damit das Ergebnis direkt geprüft werden kann. Kein Button im UI.

## Geänderte Dateien
- `src/server/pressure-map.server.ts` (Landfarbe, H/T-Grösse, Bildhöhe/Padding)
