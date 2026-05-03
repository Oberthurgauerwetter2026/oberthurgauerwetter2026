# Endzeit-Korrektur: 05:00 statt 06:00

Datenfenster für „Heute Nachmittag & Abend" und „Heute Abend & Nacht" endet künftig um 05:00 Uhr Folgetag (statt 06:00).

## Änderungen
- `src/server/forecast.functions.ts` Z.693 (Kommentar), Z.702 (`< 5`), Z.816 (`endHour = 5`), Z.914 (Prompt-Hinweis: „bis 05:00")
- `src/server/forecast.auto.ts` Z.307 (`< 5`), Z.411 (`endHour = 5`)