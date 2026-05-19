# FU-Berlin-Namen für Hochs und Tiefs übernehmen

## Ausgangslage

Die FU Berlin („Aktion Wetterpate") vergibt Vornamen für Hoch- und Tiefdruckgebiete. Diese Namen tauchen aber **nur als Text-Label im GIF** (`emtbkna.gif` / `anabwkna.gif`) auf. Auf wetterpate.de gibt es zwar eine Liste der vergebenen Namen, aber **ohne Koordinaten** – also keine Information, welcher Name zu welchem H/T auf unserer Karte gehört.

Es gibt keinen offiziellen JSON-/Text-Feed mit Name + Position.

## Vorschlag: OCR im GitHub-Action-Generator

Da unser Generator bereits als GitHub Action läuft (Ubuntu-Runner, freie IP), können wir dort einmal pro Lauf das FU-Berlin-Prognose-GIF holen, per OCR die Namens-Labels samt Bildkoordinaten extrahieren, und sie unseren erkannten Druckzentren zuordnen.

### Ablauf pro Lauf

1. `emtbkna.gif` von `page.met.fu-berlin.de` herunterladen.
2. Mit **Tesseract** (deutsche Sprachdatei) OCR über das Bild, Wort-Bounding-Boxes auslesen.
3. Wörter filtern, die wie Vornamen aussehen (Großbuchstabe + Kleinbuchstaben, kein Zahlencode, in der Nähe eines „H" oder „T"-Symbols).
4. Bildpixel-Koordinaten der FU-Karte → geografische Koordinaten transformieren (die FU-Karte nutzt eine bekannte stereographische Projektion über Europa; einmalig kalibriert über 3–4 Referenzpunkte).
5. Unsere bestehenden Hoch-/Tief-Zentren (haben wir bereits aus dem Druckfeld) → für jedes Zentrum nächstgelegenes OCR-Label im Umkreis von z. B. 500 km zuordnen.
6. SVG-Render: zusätzlich zum „H 1024" / „T 998" den zugeordneten Namen drunter setzen (kleinere kursive Schrift, z. B. „Zeno", „Inga").

### Fallbacks

- OCR liefert keinen Treffer in der Nähe → wir rendern wie bisher nur H/T + Druck, ohne Name.
- GIF-Download schlägt fehl → Lauf bricht nicht ab, Karte wird ohne Namen generiert.
- Falls Tesseract zu unzuverlässig ist: Wechsel auf Lovable AI Gateway (`google/gemini-2.5-flash` mit Bild-Input) als Alternativ-Extraktor.

### Attribution

In der SVG-Fußzeile zusätzlich: „Namen: Aktion Wetterpate, FU Berlin" mit Link auf wetterpate.de. Die Namen selbst sind Fakten, das GIF wird nicht weiterverbreitet.

## Technische Details

- Neue Datei `pressure-map-generator/fu-berlin-names.mjs` mit Funktionen `fetchFuBerlinMap()`, `ocrPressureLabels(buffer)`, `pixelToLatLon(x,y)`, `matchNamesToCenters(centers, labels)`.
- `generate.mjs`: nach Berechnung der Zentren `matchNamesToCenters(...)` aufrufen, Namen ins SVG-Render-Modell schreiben.
- GitHub-Action `pressure-map.yml`: `apt-get install -y tesseract-ocr tesseract-ocr-deu` vor dem Node-Step.
- Keine neuen Secrets nötig.
- Keine App-Änderungen – die App liest weiter dieselbe Storage-SVG.

## Offene Frage

Soll ich direkt mit **Tesseract** starten (kostenlos, deterministisch, aber bei dichten Beschriftungen u. U. ungenau) oder gleich mit **Lovable AI / Gemini Flash** (robuster bei verrauschten GIFs, minimale Kosten pro Lauf)?
