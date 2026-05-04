## Ziel

- "Heute Abend & Nacht" enthält den **echten Tiefstwert** (nächtliches Minimum bis Sonnenaufgang) — bereits umgesetzt durch das verlängerte Fenster bis 09:00.
- Im Block "Morgen, Dienstag 05. Mai" wird der **Tiefstwert weggelassen**, weil er bereits im Vortag-Block steht. Es bleibt nur der Höchstwert.

## Umsetzung in `src/server/forecast.auto.ts`

1. **Tag 1 (morgen) im Abendmodus: tmin entfernen**
   - In der Schleife `for (let i = 1; i <= 5; i++)` in `runAutoForecast`:
     - Wenn `i === 1` und `autoHour >= 12` (Abendblock aktiv) → `day.tmin = null` setzen, bevor die Daten an die KI gehen.
     - Zusätzlich `day.tmin_omitted_reason = "Tiefstwert wurde bereits im Block 'Heute Abend & Nacht' genannt"` als Hinweis für die KI.

2. **Prompt-Hinweis für den "Morgen"-Eintrag**
   - User-Prompt erweitern, wenn `tmin_omitted_reason` gesetzt ist:
     `"Hinweis: Erwähne für diesen Tag KEINEN Tiefstwert — der nächtliche Tiefstwert wurde bereits im vorherigen Abschnitt 'Heute Abend & Nacht' angegeben. Schreibe nur den Höchstwert."`

3. **Sicherstellen, dass der System-Prompt das toleriert**
   - In `buildSystemPrompt` (`src/server/forecast.functions.ts`) prüfen, ob es eine Pflicht gibt, immer Tiefst- und Höchstwert zu nennen. Falls ja, eine Ausnahme ergänzen: "Wenn `tmin` `null` oder weggelassen ist, KEIN Tiefstwert nennen."

## Nicht geändert

- Tage 2–5: Tiefst- und Höchstwert bleiben wie bisher.
- "Heute Abend & Nacht"-Block: bleibt unverändert (Fenster bis 09:00 bereits aktiv).