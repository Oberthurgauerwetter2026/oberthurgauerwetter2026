## Ziel

Verhindern, dass die KI in „Heute"-Einträgen Tageszeiten erwähnt, die bereits vergangen sind (z. B. „vor allem am Morgen" um 15 Uhr).

## Änderung

In `src/server/forecast.functions.ts` und `src/server/forecast.auto.ts`: neue Helfer-Funktion `buildTimeOfDayHint(hour)` und Aufruf in `buildFirstEntryContext`.

### Logik
Aus aktueller Zürcher Stunde wird abgeleitet, welche Tageszeit-Begriffe noch erlaubt bzw. verboten sind:

| Tageszeit | gilt als „vorbei" ab |
|---|---|
| frühe Morgenstunden | 05:00 |
| Morgen | 10:00 |
| Vormittag | 12:00 |
| Mittag | 14:00 |
| Nachmittag | 17:00 |
| Abend | 22:00 |
| Nacht | nie (Fenster reicht bis 05 Folgetag) |

`windowHint` wird ergänzt:
> „AKTUELLE UHRZEIT: HH:00 (Europe/Zurich). Erwähne AUSSCHLIESSLICH noch kommende Tageszeiten: {liste}. Folgende Tageszeiten sind bereits vergangen und dürfen NICHT erwähnt werden: {liste}."

Gilt sowohl für vollen „Heute"-Eintrag (vor 12 Uhr) als auch für Teilfenster „Nachmittag & Abend" / „Abend & Nacht" — additiv zum bestehenden Fenster-Hinweis.

### Statischer Systemprompt
`forecast.functions.ts` Zeile ~913: Bullet leicht entschärfen — „beschreibe den **verbleibenden** Tagesverlauf chronologisch; verwende nur die im userPrompt aufgeführten erlaubten Tageszeiten".

## Scope
- Folgetage (Morgen, Übermorgen, …) unverändert.
- Keine DB-/Schema-Änderung.
- Beide Codepfade (Auto-Generierung in `forecast.auto.ts` + manueller Generate-Flow in `forecast.functions.ts`) bekommen identische Logik.
