## Ziel

1. Die eigene Karte überall klar als **„Bodendruckkarte"** benennen.
2. Das Kartenlayout deutlich professioneller gestalten (Look Richtung amtliche Wetterkarte).
3. Die Hoch-/Tiefdrucknamen (FU Berlin „Aktion Wetterpate") bleiben unverändert erhalten.

## 1. Benennung

- `pressure-map-generator/generate.mjs`: Titel von `Bodendruck Europa — …` auf
  `Bodendruckkarte Europa · <Datum> · 12 UTC` ändern.
- `src/routes/_app.settings.tsx`: Labels/Überschriften vereinheitlichen
  („Bodendruckkarte (eigenes Modell)", „Öffentliche Bild-URL der Bodendruckkarte",
  „HTML-Einbindecode Bodendruckkarte"). Die DWD-Karte bleibt separat als
  „DWD-Bodenanalyse (mit Fronten)".
- Alt-Texte der Einbindecodes entsprechend anpassen (bleiben SEO-tauglich).

## 2. Professionellere Gestaltung (nur `generate.mjs`, SVG-Render)

Kopfzeile
- Klare Titelleiste: links Titel + Untertitel linksbündig statt zentriert,
  rechts Gültigkeitszeit als eigener Block (`Gültig: Do 30.07.2026, 12 UTC`)
  und darunter Modell-/Laufangabe.
- Dünne Trennlinie unter dem Kopf, definierter Aussenrahmen um das Kartenfeld.

Kartenfläche
- Ozean/Land-Kontrast ruhiger: entsättigte Landfläche, feinere Küstenlinien
  (0.6 px), Ländergrenzen dünner und heller als Küsten.
- Gradnetz dezenter (gestrichelt, geringere Deckkraft) plus kleine
  Gradbeschriftungen am Rahmenrand (10°W, 0°, 10°E … / 40°N, 50°N …).
- Isobaren: Haupt-Isobaren (jede 20 hPa) kräftig, Zwischenlinien dünn;
  Isobarenzahlen mit weissem Halo bleiben, aber Platzierung entzerren
  (Mindestabstand zwischen Labels, keine Labels am Kartenrand).
- Niederschlagsflächen leicht weichzeichnen/abrunden, damit die Contour-Kanten
  weniger „technisch" wirken.

Druckzentren (Namen bleiben!)
- H/T-Symbol typografisch sauberer: Serifen-Grossbuchstabe, ohne weissen
  Vollkreis — stattdessen dezenter Halo, damit die Isobaren durchlaufen.
- Name weiterhin über dem Symbol, kursiv; Kerndruck darunter mit `hPa`-Einheit.
- Kollisionsvermeidung: überlappende Beschriftungen werden vertikal versetzt.

Legende / Fusszeile
- Legendenblock in einer hellen Leiste am unteren Rand mit klarer Trennung:
  Temperatur 850 hPa, Niederschlag 6 h, Isobarenabstand-Hinweis.
- Fusszeile links: Quellenangabe (Open-Meteo / DWD ICON-EU, Namen FU Berlin),
  rechts: Erstellungszeitpunkt UTC.

Typografie/Farben
- Einheitliche Schriftfamilien-Konstante statt der wiederholten Inline-Strings;
  eine Hilfsfunktion `text(x, y, content, opts)` reduziert Duplikate.
- Konsistente Farbpalette (Slate-Töne für Text/Rahmen, unveränderte Skalen für
  T850 und Niederschlag, damit bestehende Legenden gültig bleiben).

## Technisches

- Änderungen betreffen ausschliesslich die SVG-Erzeugung in `buildSvg()` sowie
  Beschriftungen im Frontend — keine Änderung an Datenbeschaffung, Extrema-
  Erkennung, `fu-berlin-names.mjs`, Storage-Pfaden oder Einbind-URLs.
- Bestehende Einbettungen in WordPress bleiben unverändert gültig
  (gleiche Datei `europe-pressure-latest.svg`, gleiche Bildmasse).
- Nach dem Umbau: GitHub-Action „Generate pressure map" einmal manuell starten
  (`FORCE_REGENERATE`), damit die neue Optik sofort live ist.
