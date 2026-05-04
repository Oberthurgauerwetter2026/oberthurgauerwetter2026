## Ziel

Der Trend-Block soll lückenlos an die 5 Tagesprognosen anschliessen und 5 Tage abdecken: **Tag 6 bis Tag 10** (heute + 5 bis heute + 9 Kalendertage). Stand heute (Mo, 4.5.2026) also **Sonntag bis Donnerstag**.

## Aktueller Zustand

In `src/server/forecast.functions.ts` an zwei identischen Stellen (in `generateForecast` und `regenerateForecast`):

- Zeile 1386 / 1513: `const trendDays = [6, 7, 8, 9].map(...)` → nur 4 Tage, Indizes 6–9
- Zeile 1388 / 1515: User-Prompt sagt "für die Tage 7-10"
- Zeile 1390 / 1517: Titel `"Trend Tag 7 – 10"`

Daten und Beschriftung widersprechen sich (off-by-one).

## Änderung

Beide Stellen (Zeilen ~1386–1391 und ~1513–1518) anpassen:

1. **Daten-Array** auf `[6, 7, 8, 9, 10]` erweitern → 5 Tage.
2. **User-Prompt** auf `"einen kurzen Trend-Ausblick (3-4 Sätze) für die Tage 6-10"` ändern.
3. **Titel** auf `"Trend Tag 6 – 10"` ändern.
4. **`maxDayLoop` / Datenverfügbarkeit prüfen**: sicherstellen, dass `withTopo(10)` Daten liefert (Open-Meteo deckt typischerweise 14–16 Tage ab — sollte passen, aber im Code kurz verifizieren). `.filter(Boolean)` fängt fehlende Tage ohnehin ab.
5. **Degraded-Modus-Hinweistext** (Zeilen 1357 und 1484) auf `"Trend Tag 6 – 10 entfällt heute"` anpassen, damit die Beschriftung konsistent bleibt.

## Nicht geändert

- Tagesprognosen 1–5 (Schleife `for i = 1..maxDayLoop`) bleiben unverändert.
- `position: 7` für den Trend-Eintrag bleibt (Sortier-Index, kein Tag-Bezug).
- Nominalstil-Validator, Sky-Consistency, MOSMIX, Bias-Korrektur — alles unberührt.
- Keine DB-Änderungen.

## Dateien

- `src/server/forecast.functions.ts` — 4 kleine Edits (2× Trend-Block, 2× Degraded-Hinweis)
