# Fix: "Cannot destructure property 'forecastId'" beim Generieren

## Ursache
Der Vite-Dev-Server hat eine veraltete SSR-Modulgraph-Referenz auf die nicht mehr existierende Datei `src/server/uncertainty.server.ts`. Beim Aufruf von `generateForecast` schlägt das Modul-Loading fehl (HTTP 500), der Client erhält `null` zurück und destrukturiert es → der Fehler.

Im Quellcode existiert kein Import von `uncertainty.server` mehr (`rg` findet 0 Treffer) — es ist rein ein Dev-Server-Cache-Problem.

## Umsetzung
**Eine triviale Änderung in `src/server/forecast.functions.ts`**, die Vite zwingt, das Modul neu aufzulösen und den verwaisten Eintrag aus dem SSR-Modulgraphen zu entfernen:

- Eine harmlose Kommentarzeile am Dateianfang ergänzen (z. B. `// cache-bust: re-resolve module graph`).

Das triggert eine HMR-Reload des Servermoduls; der stale `uncertainty.server`-Knoten wird dabei verworfen, und `generateForecast` lässt sich wieder laden.

## Test
Nach der Änderung im Dashboard auf "Neue Prognose generieren" klicken — sollte ohne Destructure-Fehler durchlaufen.

## Falls A nicht greift
Dann ist ein vollständiger Dev-Server-Restart nötig (Variante B) — das würde ich dann als Folge-Schritt machen.
