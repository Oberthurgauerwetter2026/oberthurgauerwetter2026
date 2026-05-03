## Ziel
Die bereits in der Datenbank existierenden Felder `mosmix_enabled` und `mosmix_stations` sind in der Settings-Oberfläche noch nicht sichtbar. Ich ergänze sie als eigene Karte.

## Änderungen in `src/routes/_app.settings.tsx`

1. **Form-State erweitern** (initial + Lade-Effekt):
   - `mosmix_enabled: true`
   - `mosmix_stations: "10935,10929"`

2. **Neue Karte „ICON-MOS (DWD MOSMIX)"** direkt nach der Karte „Wettermodelle (Open-Meteo)" einfügen mit:
   - **Switch** „MOSMIX-Korrektur für Tag 0/1 aktivieren" → bindet an `mosmix_enabled`
   - **Input** „MOSMIX-Stationen (DWD-IDs, komma-getrennt)" → bindet an `mosmix_stations`, Placeholder `10935,10929`
   - Kurze Beschreibung: „Statistisch korrigierte Punktvorhersagen vom DWD. Standard: 10935 (Friedrichshafen), 10929 (Konstanz). Bei aktiviertem MOSMIX wird die manuelle Stations-Bias-Korrektur für Tag 0/1 übersprungen."

3. **Speicher-Payload** (`upsert` auf `app_settings`) um beide Felder ergänzen.

## Komponenten
`Switch` aus `@/components/ui/switch` importieren (falls noch nicht vorhanden).

Keine DB-/Server-Änderungen nötig — die Spalten existieren bereits und werden von `forecast.functions.ts` / `forecast.auto.ts` gelesen.