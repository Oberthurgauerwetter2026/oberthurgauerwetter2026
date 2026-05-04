## Ziel

Der Trend-Block soll die **Grosswetterlage** für Tag 6–10 umreissen — bewusst allgemeiner und weniger detailliert als die Tagesprognosen.

## Änderung

In `src/server/forecast.functions.ts` an beiden Stellen (Zeile 1388 in `generateForecast`, Zeile 1515 in `regenerateForecast`) den User-Prompt erweitern:

**Vorher:**
```ts
`Standort: ${locationName}. Schreibe einen kurzen Trend-Ausblick (3-4 Sätze) für die Tage 6-10 auf Basis dieser Daten:\n${JSON.stringify(trendDays, null, 2)}`
```

**Nachher:**
```ts
`Standort: ${locationName}. Schreibe einen kurzen Trend-Ausblick (3-4 Sätze) für die Tage 6-10, der die Grosswetterlage umreisst (z. B. dominierende Strömung, Hoch-/Tiefdruckeinfluss, übergeordnete Temperaturtendenz, allgemeiner Niederschlagscharakter). Keine tagesgenauen Werte, keine konkreten Temperaturen, keine Wochentagsnennung — bewusst allgemeiner und unschärfer als die Tagesprognosen. Datenbasis:\n${JSON.stringify(trendDays, null, 2)}`
```

## Nicht geändert

- Datenbasis (`trendDays = [6,7,8,9,10]`), Titel, Position, Nominalstil-Validator, System-Prompt-Template — alles unberührt.
- Tagesprognosen 1–5 bleiben so detailliert wie bisher.

## Dateien

- `src/server/forecast.functions.ts` — 2 identische Prompt-Edits
