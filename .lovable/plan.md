# Tiefstwerte am Folgetag weglassen, wenn die Abendprognose sie schon enthält

## Ausgangslage

Wenn die Prognose nach 17:00 Uhr generiert wird, heisst der erste Eintrag „Heute Abend & Nacht" und enthält bereits die **Tiefstwerte der kommenden Nacht** (denn die Nacht 00–06 des Folgetags gehört noch zu diesem Fenster).

Der Tag-1-Eintrag („Morgen, …") nennt aktuell trotzdem nochmals dieselben Tiefstwerte — weil `DEFAULT_TEMP_RULES` einen Tiefstwerte-Satz für jeden Tag erzwingt. Das ist eine **redundante Doppelnennung**.

Bereits umgesetzt ist nur, dass Tag 1 die **Vornacht-Beschreibung** (Bewölkung, Schauer 00–06) auslassen muss (`tag1Hint` in Zeile 1964 / 2115). Die Tiefstwerte wurden dabei vergessen.

## Änderung

**Eine Stelle:** Der `tag1Hint` in `forecast.functions.ts` (Zeilen 1963–1965 und 2114–2116) wird ergänzt um:

> „Da die Tiefstwerte der kommenden Nacht bereits im vorherigen Eintrag genannt wurden, darf der Tag-1-Eintrag **keinen Tiefstwerte-Satz** enthalten. Beginne Absatz 2 direkt mit den Höchstwerten („Höchstwerte um Z Grad.") oder lasse Absatz 2 weg, wenn nur Höchstwerte zu nennen wären."

Diese Ergänzung greift **nur**, wenn der erste Eintrag „Heute Abend & Nacht" ist (also Generierung nach 17:00) — also genau in den Fällen, wo `tag1Hint` heute schon gesetzt wird. Bei Generierung am Morgen oder Nachmittag bleibt alles unverändert: dann nennt der Heute-Eintrag keine kommende Nacht und Tag 1 muss seine Tiefstwerte weiterhin nennen.

## Was nicht geändert wird

- `DEFAULT_TEMP_RULES` bleibt unverändert (gilt weiter als Default für alle anderen Tage).
- Tag 2–5 nennen ihre Tiefstwerte wie bisher.
- Keine Änderung an Datenmodell, UI oder Aggregation.

## Effekt

Im Abend-/Nacht-Generierungslauf liest sich der Übergang vom Heute- zum Morgen-Eintrag flüssig: die Tiefstwerte stehen einmal am Ende von „Heute Abend & Nacht", und der „Morgen, …"-Eintrag startet inhaltlich um 06:00 mit dem Tagesgang und nennt nur noch Höchstwerte.
