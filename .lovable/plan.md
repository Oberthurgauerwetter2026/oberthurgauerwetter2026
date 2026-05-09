## Ziel

Alt-Text und Beschreibung des Einbettungs-Snippets aktualisieren, damit sie die neuen Layer (T850, Niederschlag) widerspiegeln.

## Änderungen

Datei: `src/routes/_app.settings.tsx`

1. **Alt-Text** (Zeile 694) — von
   `"Bodendruckkarte Europa heute 12 UTC – DWD ICON-EU"`
   auf
   `"Wetterkarte Europa 12 UTC – Bodendruck, Temperatur 850 hPa und Niederschlag (DWD ICON-EU)"`.

2. **CardTitle** (Zeile 699) — von
   `"Bodendruckkarte (Europa)"`
   auf
   `"Wetterkarte Europa (Druck · T850 · Niederschlag)"`.

3. **CardDescription** (Zeilen 700–703) — Text erweitern:
   *„Tägliche Karte mit Isobaren, Temperatur in 850 hPa und 6 h-Niederschlag, gültig für 12:00 UTC. Modell DWD ICON-EU via Open-Meteo. Wird automatisch täglich neu erzeugt; die Bild-URL bleibt stabil und kann direkt in WordPress eingebettet werden."*

4. **Inline-`<img alt>`** in der Vorschau (Zeile 724) — von `"Bodendruckkarte Europa"` auf den gleichen neuen Alt-Text wie in (1), damit Vorschau und Snippet konsistent sind.

## Nicht geändert

Endpoint, URL, Logik, Storage-Pfad — nur Texte.
