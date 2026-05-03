# Tageszeit-abhängiger erster Eintrag bei „Neu generieren"

Der erste Eintrag einer Vorhersage soll dynamisch vom aktuellen Zeitpunkt abhängen, nicht immer der Ganztages-Eintrag sein:

| Zeit (Europe/Zurich) | Erster Eintrag | Datenfenster |
|---|---|---|
| 00:00 – 11:59 | „Heute, Wochentag DD. Monat" | Ganzer Tag (wie heute) |
| 12:00 – 16:59 | „Heute Nachmittag & Nacht" | jetzt → 06:00 Folgetag |
| 17:00 – 23:59 | „Heute Abend & Nacht" | jetzt → 06:00 Folgetag |
| 05:00 nächster Tag | wieder ganzer Tag (neuer „Heute") | ganzer Tag |

Folge-Einträge (Tag 1 = „Morgen", Tag 2–5, Trend Tag 6–10) bleiben unverändert.

## Stand heute

Die Hilfsfunktionen `currentZurichHour()`, `restOfDayTitle()` und `formatEveningNight()` existieren bereits in beiden Modulen, werden aber nicht aufgerufen — der erste Eintrag wird stattdessen immer als Ganztag generiert.

## Änderungen

### `src/server/forecast.functions.ts`
- **`generateForecast`** (Block ab Zeile ~1084): erster Eintrag mit `currentZurichHour()` entscheiden:
  - `< 12`: bisherige Logik (Ganztag mit `withTopo(0)`)
  - `>= 12`: `formatEveningNight(weather)` als Datenbasis, Titel via `restOfDayTitle(hour, today)`, Prompt mit Hinweis: „Beziehe dich ausschliesslich auf den Zeitraum {window_label}".
- **`regenerateForecast`** (Block ab Zeile ~1211): identische Logik (DRY: gemeinsamer Helper `buildFirstEntry(weather, withTopo, today, locationName)`).

### `src/server/forecast.auto.ts`
- **`runAutoForecast`** (Block ab Zeile ~729): identisch.
- Note `Auto-generiert (18:00)` dynamisch anpassen → `Auto-generiert (Abend)` / `Auto-generiert (Morgen)` je nach Stunde.

### Prompt-Hinweis (in `DEFAULT_GENERAL_STYLE`)
Aktuell steht dort „Alle Einträge … basieren auf TAGES-Werten". Ergänzen: „Ausnahme: Wenn der Eintragstitel ‚Heute Nachmittag & Nacht' oder ‚Heute Abend & Nacht' lautet, nutze die mitgelieferten Fenster-Werte (window_label, tmin/tmax/precip_total/wind_max bezogen auf das Fenster) und beschreibe ausschliesslich diesen Zeitraum chronologisch."

## Cron-Setup (Vorschlag)
Aktuell läuft Auto-Generation 1×/Tag um 18:00. Ich würde **zusätzlich** einen 05:30-Lauf einrichten:
```sql
-- Bestehender 18:00-Lauf bleibt
-- NEU: täglicher Morgen-Lauf
SELECT cron.schedule('auto-forecast-morning', '30 5 * * *',
  $$ SELECT net.http_post(
       url := 'https://oberthurgauerwetter2026.lovable.app/api/public/hooks/auto-forecast',
       headers := '{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
       body := '{}'::jsonb) $$);
```
(Optional — sag Bescheid, ob du den 2. Cronjob möchtest oder nur die manuelle „Neu generieren"-Logik anpassen willst.)

## Auswirkung
- Klickst du um 19:00 „Neu generieren" → erster Eintrag „Heute Abend & Nacht" mit Daten von 19:00–06:00.
- Klickst du um 06:00 → erster Eintrag „Heute, Sonntag 03. Mai" mit Ganztagswerten.
- Bestehende Vorhersagen werden nicht migriert.