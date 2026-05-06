# Gemessene Werte: nur intern nutzen, nicht im Text erwähnen

## Ziel

Die SMN-/Radar-Messungen sollen weiterhin das Stundenprofil für Tag 0 schärfen (vergangene Stunden = reale Werte statt Modell-Median), aber **nicht mehr explizit im Prognosetext auftauchen** ("gemessen", "beobachtet", "heute Morgen wurden 4 °C gemessen" etc.).

Die Prognose soll wie bisher als zusammenhängender Wetter-Text wirken — egal ob die Zahl aus Messung oder Modell stammt.

## Was sich ändert

**Eine Stelle:** Die Prompt-Regel zur Spalte `Quelle` in `forecast.functions.ts` (rund Zeile 1773) wird umformuliert:

- **Entfernen:** Die Anweisung, `obs`-Stunden als „gemessen", „beobachtet" oder „im Rückblick" zu formulieren.
- **Entfernen:** Der Beispielsatz „am Morgen wurden 3 °C gemessen".
- **Behalten:** Der Hinweis, dass Werte mit `Quelle = obs` **verbindlich** sind und Vorrang vor Modellwerten haben (für die Genauigkeit der Stundenangaben).
- **Neu hinzufügen:** Eine ausdrückliche Regel: *Die Spalte `Quelle` ist nur ein internes Qualitätssignal. Im Text dürfen Begriffe wie „gemessen", „beobachtet", „laut Messung", „Stationsdaten" o. Ä. **nicht** verwendet werden. Die Prognose bleibt durchgehend in der Form einer einheitlichen Wetterbeschreibung — unabhängig von der Datenquelle.*

## Was *nicht* Teil ist

- Keine Änderung an `applyObservedOverlay`, `buildHourlyProfile` oder der Stundenprofil-Tabelle selbst.
- Keine UI-Änderung in `WeatherDataView.tsx` (Messungen bleiben im UI nicht sichtbar — gewünscht).
- Keine Änderung am Datenmodell (`src`-Feld bleibt im `hourly_profile`).

## Effekt

- Der Tagesgang im Text wird weiterhin präziser durch reale Werte (z. B. korrekter Zeitpunkt eines Schauers).
- Im Text liest sich die Prognose wieder als reine Wetterbeschreibung ohne Mess-Sprache.
