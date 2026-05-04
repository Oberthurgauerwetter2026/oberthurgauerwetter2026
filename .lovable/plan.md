## Ziel

Der Trend-Ausblick am Ende der Prognose soll nur noch **Tag 7 – 10** abdecken (statt aktuell Tag 6 – 10), weil Tag 6 bereits in der regulären Tagesschleife enthalten ist.

## Was sich ändert

Datei: `src/server/forecast.functions.ts`

An zwei Stellen (in `generateForecast` und `regenerateForecast`):

1. **Trend-Tage anpassen**
   - Vorher: `[5, 6, 7, 8, 9].map((i) => withTopo(i))` → Tag 6 – 10
   - Nachher: `[6, 7, 8, 9].map((i) => withTopo(i))` → Tag 7 – 10

2. **Prompt-Text anpassen**
   - Vorher: „kurzen Trend-Ausblick (3-4 Sätze) für die Tage 6-10"
   - Nachher: „kurzen Trend-Ausblick (3-4 Sätze) für die Tage 7-10"

3. **Eintrag-Titel anpassen**
   - Vorher: `title: "Trend Tag 6 – 10"`
   - Nachher: `title: "Trend Tag 7 – 10"`

4. **Hinweistext im Degraded-Modus anpassen**
   - Vorher: „… sowie Trend Tag 6 – 10 entfallen heute."
   - Nachher: „… sowie Trend Tag 7 – 10 entfallen heute."

## Was sich NICHT ändert

- Keine DB-Migration, keine Schema-Änderungen.
- Bestehende, bereits gespeicherte Prognosen bleiben unberührt (alter Titel „Trend Tag 6 – 10" bleibt dort erhalten — neue Prognosen tragen den neuen Titel).
- Keine Änderung an der Tagesschleife (Tag 1 – 5 als Einzeltage), an der Anzahl Einträge (`position 1 – 7`) oder an der MOSMIX-Fallback-Logik.

## Erwartetes Ergebnis

Neue Prognosen enthalten am Ende einen Block „Trend Tag 7 – 10" mit 4 Tagen MOSMIX-/Open-Meteo-Daten. Die bisherige Doppelung zwischen Tag 6 (regulärer Eintrag) und Tag 6 (Beginn des Trends) entfällt.