## Ziel
Auf der Bodendruckkarten-Ansicht zusätzlich die offizielle DWD-Bodenanalyse (inkl. Fronten, H/T-Symbole) anzeigen. Rechtlich sauber über die DWD-GeoNutzV mit sichtbarer Quellenangabe „Quelle: Deutscher Wetterdienst".

## Hintergrund
Der DWD stellt die Europa-Bodenanalyse als PNG bereit:
`https://www.dwd.de/DWD/wetter/wv_allg/europa/bilder/bwk_bodendruck_na_ana.png`
Nutzung ist gemäß **GeoNutzV** frei, sofern Quelle genannt wird. Wir generieren weiterhin unsere eigene SVG (Isobaren/Modelldaten); die DWD-Karte kommt als **eigenständige zweite Ansicht** dazu – kein Overlay, da Projektion/Ausschnitt nicht exakt passen.

## Änderungen

1. **Neuer Proxy-Endpoint `src/routes/api/public/maps/dwd-bodenanalyse[.]png.ts`**
   - Fetcht die DWD-PNG serverseitig (vermeidet CORS / Hotlink-Probleme).
   - Cached die Antwort kurz im Memory/Cache-Header (z. B. 15 min `s-maxage`).
   - Setzt `Content-Type: image/png` und `Cache-Control: public, max-age=900`.
   - Bei Fehler des Upstreams: 502 mit kurzer Meldung.

2. **Anzeige in der App** (dort wo aktuell die Modell-SVG gezeigt wird, z. B. Dashboard-/Forecast-Karte)
   - Unter/neben der bestehenden Modellkarte ein zweites Bild:
     `<img src="/api/public/maps/dwd-bodenanalyse.png" alt="DWD Bodenanalyse Europa mit Fronten" />`
   - Darunter Pflicht-Quellenangabe als sichtbarer Text + Link:
     „Quelle: [Deutscher Wetterdienst](https://www.dwd.de) (GeoNutzV)".
   - Kurzer Hinweis: „Offizielle DWD-Analyse mit Fronten. Unsere Isobarenkarte oben basiert auf Modelldaten (ICON/ECMWF/GFS)."

3. **Einstellungs-Seite**
   - In der Druckkarten-Card zusätzlich die neue DWD-URL anzeigen + Copy-Button:
     `https://oberthurgauerwetter2026.lovable.app/api/public/maps/dwd-bodenanalyse.png`
   - Keine Änderungen am bestehenden eigenen Generator.

## Bewusst NICHT enthalten
- Kein Overlay über unsere SVG (Projektion passt nicht).
- Keine Fronten-Extraktion aus dem DWD-Bild (zu fehleranfällig).
- Kein Hotlink direkt aus dem Browser auf dwd.de (Proxy ist sauberer und cachebar).

## Ergebnis
Nutzer sehen weiterhin die eigene Modell-Druckkarte und darunter die offizielle DWD-Bodenanalyse mit Fronten, korrekt als DWD-Quelle ausgewiesen.