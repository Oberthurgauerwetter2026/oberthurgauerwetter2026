## Ziel

Täglich automatisch eine eigene Bodendruckkarte (Europa, ~30°N–70°N / 25°W–45°E, gültig für heute 12 UTC) als PNG erzeugen und unter einer **stabilen URL** bereitstellen, die per `<img src="…">` in WordPress eingebunden werden kann.

## Datenquelle

DWD ICON-EU MSL-Druck via Open-Meteo (Modell `icon_eu`, Variable `pressure_msl`, ein Wert für 12:00 UTC). Open-Meteo liefert die DWD-ICON-Daten kostenlos und Worker-kompatibel über HTTP/JSON — kein GRIB-Parsing nötig.

Es wird ein regelmässiges Gitter mit ~1.5°-Schritt abgefragt (≈ 27 × 28 Punkte ≈ 756 Punkte). Die Anfrage wird in mehreren Batches an Open-Meteo gestellt (Multi-Location-Endpoint), das Ergebnis ist ein 2D-Druckfeld in hPa.

## Rendering

In einer TanStack-Server-Function:

1. Druckfeld glätten (einfacher Gauss-Filter über das Gitter).
2. Isobaren alle 5 hPa (980, 985, …, 1040) mit `d3-contour` (pure JS, Worker-tauglich) aus dem Gitter berechnen.
3. Linien in eine SVG zeichnen, mit:
   - Küstenlinien + Ländergrenzen (statisches, vereinfachtes GeoJSON von Natural Earth, einmal in `/public` abgelegt).
   - Mercator-ähnliche Projektion (einfache äquidistante Plattkarte reicht für diesen Ausschnitt).
   - Druck-Beschriftungen entlang der Linien.
   - **H** an lokalen Maxima, **T** an lokalen Minima (Detektion über 3×3-Nachbarschaft, Mindestabstand zwischen Markern).
   - Header mit Titel, Lauf-Zeitstempel, Quellennennung „Modell DWD ICON-EU, gültig HH:MM UTC".
4. SVG → PNG via `@resvg/resvg-wasm` (läuft in Cloudflare Workers).

## Speicherung & Auslieferung

- Neuer öffentlicher Storage-Bucket `weather-maps` in Lovable Cloud.
- Die Karte wird unter dem festen Pfad `weather-maps/europe-pressure-latest.png` gespeichert und täglich überschrieben → die öffentliche URL bleibt **immer dieselbe**, ideal zum Einbetten.
- Zusätzlich Archiv unter `weather-maps/archive/europe-pressure-YYYY-MM-DD.png` für spätere Recherche.

## Tägliche Generierung

- Server-Route `POST /api/public/hooks/generate-pressure-map` triggert die Erzeugung und das Hochladen.
- `pg_cron` ruft diese Route täglich um 13:30 UTC (≈ 1.5 h nach Verfügbarkeit des 12-UTC-Laufs) und nochmals um 06:00 UTC (Backup) auf.
- Manueller „Jetzt neu erzeugen"-Button im Admin-Bereich (`/settings`) für Tests.

## UI im Tool

Im internen Tool eine kleine Vorschau-Karte unter Settings: aktueller Stand der erzeugten Karte + Zeitstempel + Button „Jetzt neu erzeugen" + die einzubindende `<img src="…">`-Zeile zum Kopieren.

## Einbettung in WordPress

Der Nutzer fügt einfach folgendes HTML in einen Custom-HTML-Block ein:

```text
<img src="https://<projekt>.supabase.co/storage/v1/object/public/weather-maps/europe-pressure-latest.png"
     alt="Bodendruckkarte Europa heute 12 UTC – DWD ICON-EU"
     style="max-width:100%;height:auto" />
```

Da die URL stabil ist, aktualisiert sich das Bild automatisch jeden Tag. Cache-Busting wird durch einen `Cache-Control: max-age=3600`-Header beim Upload sichergestellt; die Stunde Cache hält Wordpress-Seitencaches kurz.

## Technische Details (für Entwickler)

- Pakete: `d3-contour`, `@resvg/resvg-wasm` (beides Edge-tauglich).
- Geodaten: Natural Earth „admin_0_countries" auf 1:110m, in `/public/geo/europe.geo.json` (ca. 200 KB) reduziert auf den Ausschnitt.
- Migration: Storage-Bucket `weather-maps` öffentlich + RLS Public-Read.
- Settings-Tabelle: optionale Zeile `pressure_map_enabled` (default true), `pressure_map_last_run`, `pressure_map_last_status`.
- Fehlerbehandlung: bei Open-Meteo-Fehler wird die alte Karte nicht überschrieben; Status wird in Settings geloggt und im UI angezeigt.

## Was bewusst NICHT enthalten ist

- Keine Frontenanalyse (würde echte Synoptik-Software brauchen).
- Keine 500-hPa-Linien, kein Niederschlagsfeld (auf deinen Wunsch hin nur Isobaren + H/T).
- Keine 1:1-Replik der FU-Berlin-Karte (Lizenz/Look gehört FU Berlin) — eigenständige Karte mit klarer Quellennennung „DWD ICON-EU".