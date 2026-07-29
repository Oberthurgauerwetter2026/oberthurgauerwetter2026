## Ziel

Die Bodendruckkarte soll optisch der hochgeladenen Referenz (MeteoSchweiz-Druckdarstellung) entsprechen: klare, weiße Isobaren auf einem ruhigen Kartenhintergrund, Druckwerte in kleinen Label-Boxen direkt auf der Linie, sehr große H/T-Symbole mit Wertangabe.

## Was sich ändert (Darstellung, nicht Daten)

1. **Farbkonzept umstellen**
   - Hintergrund/Meer: kräftiges Dunkelblau statt weiß.
   - Landflächen: helles Salbei-/Oliv-Grün, Länder- und Küstenlinien in gedecktem Blau.
   - Seen/Binnengewässer in der Meerfarbe.

2. **Isobaren im Referenz-Stil**
   - Weiße Linien, gleichmäßige Stärke, deutlich sichtbar; Haupt-Isobaren (je 20 hPa) minimal dicker statt hart kontrastiert.
   - Druckwerte als kleine, halbtransparente Boxen mit blauer Schrift, direkt in die Linie eingesetzt (Linie unter dem Label unterbrochen).
   - Abstand der Labels entlang langer Linien, damit sich nichts überlagert.

3. **H/T-Zentren wie in der Referenz**
   - Sehr große, weiße, fette Buchstaben (H/T) statt der aktuellen Serifen-Variante.
   - Kerndruckwert klein darunter, FU-Berlin-Namen bleiben erhalten.

4. **Flächen zurücknehmen**
   - Die farbigen Temperatur-850-hPa- und Niederschlagsflächen dominieren aktuell das Bild. Vorschlag: Temperaturflächen entfernen (oder stark abgeschwächt als Option), Niederschlag optional dezent — die Referenz zeigt eine reine Druckkarte.

5. **Kopf, Legende, Quellenangabe** an das dunkle Layout anpassen (helle Schrift), Titel „Bodendruckkarte Europa" und DWD/Open-Meteo-Quellen bleiben.

## Technische Umsetzung

- Anpassung erfolgt in beiden Renderern parallel, damit GitHub-Action und Worker-Fallback identisch aussehen:
  - `pressure-map-generator/generate.mjs`
  - `src/server/pressure-map.server.ts`
- Betroffen sind ausschließlich die Zeichenfunktionen (Hintergrund-Rect, Land-/Grenz-Pfade, Isobaren-Stroke und Label-Rendering, Extrema-Symbole, Legende). Das 1,25°-Datengitter, die Kontur-Berechnung und die Zentren-Erkennung bleiben unverändert.
- Verifikation: lokaler Testlauf mit zwischengespeicherten Gitterdaten (kein erneuter Open-Meteo-Abruf wegen Ratelimits) und Screenshot-Kontrolle, danach einmaliger manueller Start der GitHub-Action.

## Offene Entscheidung

Temperaturflächen: komplett raus (näher an der Referenz) oder dezent im Hintergrund behalten? Standard im Plan: raus, Niederschlag dezent behalten.
