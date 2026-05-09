Aktuell schreibt der Tag-0-Eintrag "Heute Nachmittag & Abend" Tiefstwerte in den Text (z. B. "Tiefstwerte in der Nacht um 11 Grad"). Das soll künftig nur noch in reinen Abend-/Nachtprognosen erscheinen.

Regel (Tag 0):
- Titel "Heute Nachmittag & Abend" → KEINE Tiefstwerte, nur Höchstwerte (sofern noch sinnvoll) und Wind/Himmel.
- Titel "Heute Abend & Nacht" → Tiefstwerte erlaubt (wie bisher), Höchstwerte werden nicht mehr genannt.

Umsetzung in `src/server/forecast.functions.ts`:
1. In `generateForecast` und `regenerateForecast` beim Tag-0-Eintrag einen `windowHint` ergänzen, der je nach `firstTitle` klar vorschreibt:
   - Bei "Heute Nachmittag & Abend": "KEIN Tiefstwerte-Satz, keine Nachtwerte, keine Bodenfrost-/Senken-Notiz. Absatz 2 enthält ausschliesslich Höchstwerte (falls noch nicht erreicht) — sonst entfällt Absatz 2."
   - Bei "Heute Abend & Nacht": Tiefstwerte gemäss bestehender Regel, KEINE Höchstwerte mehr (entspricht bereits dem heutigen Verhalten).
2. Diese Ausnahme überschreibt die `DEFAULT_TEMP_RULES` für diesen Eintrag.
3. Der bestehende Tag-1-Hinweis (keine Tiefstwerte, weil schon im Tag-0-Eintrag genannt) greift nur, wenn der Tag-0-Eintrag tatsächlich Tiefstwerte gebracht hat — also nur bei `firstTitle === "Heute Abend & Nacht"`. Das ist heute schon korrekt.

Danach genügt eine Regeneration, um den aktuellen Sonntag/Heute-Eintrag zu korrigieren.