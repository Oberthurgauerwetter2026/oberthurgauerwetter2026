## Problem

Im Abschnitt "Heute Abend & Nacht" wird aktuell ein Tiefstwert von 14 °C angegeben, während für Dienstag 9 °C steht. Das wirkt widersprüchlich, weil der echte Tiefstwert in den frühen Morgenstunden des Dienstags (ca. 05–08 Uhr) liegt — und damit eigentlich noch zur Nacht von "heute" gehört.

## Ursache

In `src/server/forecast.auto.ts` (Funktion `formatEveningNight`, Zeilen ~295–435) wird das Zeitfenster wie folgt gebildet:

- Start: aktuelle Stunde (z. B. 18:00)
- Ende: **05:00 des Folgetags** (`endHour = 5`, Zeile 411 und Filter Zeile 307)

Damit endet das Fenster, bevor das eigentliche Temperatur-Minimum erreicht ist. Der Dienstag-Tageswert (`temperature_2m_min` aus dem Modell) deckt dagegen den ganzen Kalendertag ab und enthält das Morgen-Minimum — daher die niedrigeren 9 °C dort.

## Lösung

Das Abend-/Nachtfenster bis in den Morgen verlängern, sodass der echte nächtliche Tiefstwert erfasst wird.

**Änderung in `src/server/forecast.auto.ts`:**

1. `endHour` von `5` auf `9` setzen (Zeile 411). 09:00 deckt typische Sonnenaufgangs-Minima das ganze Jahr über ab.
2. Filter in Zeile 307 entsprechend anpassen: `dt.getHours() < 9` statt `< 5`.
3. `window_label` (Zeilen 412–415) so anpassen, dass es korrekt "bis 09:00 (morgen früh)" ausweist und im Text klar wird, dass die frühen Morgenstunden des Folgetags eingeschlossen sind.
4. Im `restOfDayTitle`/Prompt-Kontext sicherstellen, dass die KI den Tiefstwert als "in der Nacht / gegen Morgen" formuliert, nicht als reinen Abendwert (kurzer Hinweis im System-/User-Prompt-Block, der `formatEveningNight`-Daten beschreibt).

Damit ergibt der Tiefstwert "Heute Abend & Nacht" und der Tageswert für Dienstag konsistente, nachvollziehbare Werte (das Nacht-Minimum landet im Heute-Block, der Dienstag-Block zeigt Tagesmin/-max).

## Nicht geändert

- Logik der `summarizeDay`-Funktion für Folgetage (Tagesmin/-max bleibt korrekt).
- Modellaggregation und Bias-Korrektur.