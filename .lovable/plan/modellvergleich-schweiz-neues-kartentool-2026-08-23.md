# Modellvergleich Schweiz – neues Kartentool

Ein neues Werkzeug unter `/modelle`: mehrere Karten-Panels nebeneinander, je ein Wettermodell, alle synchron über eine gemeinsame Zeitachse steuerbar. Das bestehende Prognose-Dashboard bleibt unverändert.

## Was der Nutzer sieht

- Raster aus 2–6 Karten-Panels (wählbar 2×1, 2×2, 3×2), jedes Panel = ein Modell.
- Kartenausschnitt: ganze Schweiz, farbige Flächendarstellung (wie Meteociel) auf einem hellen Reliefhintergrund mit Kantonsgrenzen, Seen und Ortsmarken.
- Gemeinsamer Zeit-Slider mit Play/Pause, Vor/Zurück und "Jetzt"-Sprung. Alle Panels zeigen immer denselben Zeitschritt.
- Parameterwahl (gilt für alle Panels gleichzeitig), Start-Set:
  - Niederschlag: Menge (1h/3h/24h-Summe), Wahrscheinlichkeit, Niederschlagsart (Regen/Schnee/Mischung aus Schneefallanteil)
  - Bewölkung: total, tief, mittel, hoch
  - Temperatur 2 m: aktuell, Tagesmin, Tagesmax
  - Wind: Mittelwind (Pfeile + Farbfläche), Böen, Windrichtung
- Pro Panel: Modellname, Lauf-Zeitpunkt, Gültigkeitszeit, max. Vorhersagereichweite. Panels mit kürzerer Reichweite (ICON-CH1, AROME) zeigen ab Ende des Laufs klar "keine Daten".
- Hover/Klick auf eine Karte zeigt den Wert an dem Punkt in allen Panels gleichzeitig (Fadenkreuz-Vergleich).
- Farbskalen-Legende unterhalb, identisch für alle Panels, damit der Vergleich gültig ist.

## Modelle (Start)

ICON-CH1, ICON-CH2, ICON-D2, AROME France HD, ARPEGE Europe, ICON-EU (als Ersatz für die vorerst fehlenden SUPER-HD/ICON-RUC), optional ECMWF IFS und GFS zuschaltbar. SUPER-HD und ICON-RUC können später ergänzt werden, sobald ein Kachelmann-API-Key vorliegt.

## Technische Umsetzung

**Datenbeschaffung (neu, ausserhalb der App)**
- Neuer GitHub-Action-Workflow `model-grid-ingest.yml` (analog zum bestehenden Open-Meteo-Ingest), Lauf 4×/Tag mit Retry und Cyon-Proxy-Fallback.
- Python-Skript `scripts/ingest_model_grid.py`: Gitter über die Schweiz (ca. 45.7–47.9 N, 5.8–10.6 E) mit ~0.08° Auflösung (≈ 27 × 60 = 1600 Punkte). Open-Meteo erlaubt Multi-Koordinaten-Anfragen; Batches à ~150 Punkte, Drosselung wie im bestehenden Skript.
- Pro Modell und Lauf wird ein kompaktes Binärraster erzeugt (Float16/Int16 pro Variable und Zeitschritt, gzip) und in den Storage-Bucket `model-grids` gelegt: `model-grids/<model>/<run>/<variable>.bin` plus ein `manifest.json` mit Gitterdefinition, Zeitschritten und Wertebereich.
- Neue Tabelle `model_grid_runs` (Modell, Lauf, Variablen, Zeitschritte, Pfad, Status) mit RLS + GRANTs; Lesen für authentifizierte Nutzer.

**Auslieferung**
- Server-Route `src/routes/api/public/model-grid/$model/$run/$variable.ts` liefert das Raster per signierter URL/Redirect aus dem privaten Bucket (gleiches Muster wie die Druckkarten-Routen, damit der Worker keine grossen Bodies streamt).
- Ein `useModelGrid`-Hook lädt Manifest + Raster einmal pro Modell/Variable und hält sie im Speicher; Zeitschritte werden client-seitig aus dem Puffer gelesen.

**Darstellung**
- Jedes Panel ist eine Leaflet-Karte (Basis wie in `RegionMap.tsx`: swisstopo-Hintergrund) mit einem Canvas-Overlay, das das Raster mit bilinearer Interpolation und der gewählten Farbskala zeichnet.
- Karten sind über einen gemeinsamen View-State gekoppelt (Zoom/Pan synchron).
- Windrichtung/-mittel als Pfeilfeld auf einem zweiten Canvas-Layer.
- Farbskalen als eigenes Modul `src/lib/model-colorscales.ts` (Niederschlag, Schnee, Bewölkung, Temperatur, Wind), Werte und Stufen an den üblichen meteorologischen Standard angelehnt.

**Neue Dateien (Übersicht)**
- `src/routes/_app.modelle.tsx` – Seite mit Panel-Raster, Parameterwahl, Zeitachse
- `src/components/model-compare/ModelPanel.tsx`, `TimelineBar.tsx`, `ParameterPicker.tsx`, `ColorLegend.tsx`
- `src/lib/model-grid.functions.ts` – Manifest-/Lauf-Abfragen
- `src/lib/model-colorscales.ts`
- `scripts/ingest_model_grid.py`, `.github/workflows/model-grid-ingest.yml`
- Migration für `model_grid_runs` + Bucket `model-grids`
- Navigationseintrag in `src/routes/_app.tsx`

## Umsetzung in Etappen

1. Datengitter, Ingest-Skript, Bucket, Tabelle und Auslieferungsroute – geprüft mit einem Modell und einer Variable.
2. Seite `/modelle` mit einem Panel, Zeit-Slider und Niederschlagsmenge.
3. Panel-Raster (2–6 Modelle), synchrone Karten und Zeitachse.
4. Restliche Parameter, Legenden, Fadenkreuz-Vergleich, Statusanzeige pro Lauf.
5. Automatisierung (Cron-Slots, Aufräumen alter Läufe nach 3 Tagen).

## Kosten und Grenzen

- Kein KI-Verbrauch; Open-Meteo bleibt kostenlos, die Datenmenge steigt aber deutlich (ca. 10–15 Anfragen pro Modell und Lauf). Bei Bedarf reduziere ich Gitterauflösung oder Anzahl Läufe.
- Rohdatengrösse pro Modell/Lauf ca. 3–8 MB komprimiert; ältere Läufe werden automatisch gelöscht.
- ICON-CH1 (33 h) und AROME HD (48 h) decken nicht den ganzen Zeitstrahl ab – das wird im Panel ausgewiesen, nicht interpoliert.
