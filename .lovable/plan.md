## Ziel
Der Nominal-/Telegrammstil muss in jeder Prognose wirken — auch wenn ein eigener Custom-Prompt unter Settings hinterlegt ist und auch in der täglichen Auto-Generierung um 18:00.

## Änderungen

### 1. `src/server/forecast.functions.ts`
- Den festen Stil-Abschnitt aus `DEFAULT_GENERAL_STYLE` (Zeilen ~1988–2010, „OBERSTE STIL-REGEL: NOMINAL- / TELEGRAMMSTIL …" inkl. Vorher/Nachher-Liste und Kontrast-Beispiel) in eine neue exportierte Konstante `NOMINAL_STYLE_BLOCK` extrahieren.
- `buildSystemPrompt` so anpassen, dass `NOMINAL_STYLE_BLOCK` **immer** vorne im System-Prompt steht — unabhängig davon, ob `settings.ai_prompt_template` gesetzt ist oder ob der Default greift.
- `DEFAULT_GENERAL_STYLE` behält den Block ebenfalls (für Settings-Default-Anzeige), wird aber im finalen Prompt entdupliziert (einfacher String-Check vor dem Voranstellen).

### 2. `src/server/forecast.auto.ts`
- `enforceNominalStyle` und `generateTextNominal` (analog zu `forecast.functions.ts`) ergänzen.
- Die drei direkten `generateText(...)`-Aufrufe (Zeilen 851, 868, 874 — Heute, Tageseinträge, Trend) auf `generateTextNominal(...)` umstellen.
- `NOMINAL_STYLE_BLOCK` aus `forecast.functions.ts` importieren und in den hier genutzten System-Prompt voranstellen (gleiche Logik wie in `buildSystemPrompt`).

### 3. `src/routes/_app.settings.tsx`
- Beim Feld „Allgemeiner Stil & Tonalität" ein kurzer Hilfetext unter Label/Description:  
  *„Die unverhandelbaren Nominal-/Telegrammstil-Regeln werden automatisch zusätzlich zu deinem Text mitgesendet — du musst sie hier nicht wiederholen."*

## Was nicht passiert
- Kein Eingriff in den DB-Wert `ai_prompt_template` — dein bestehender Custom-Prompt bleibt unverändert wirksam.
- Keine Änderung am `generateTextNominal`-Retry-Mechanismus (max. 1 Retry bleibt, ist ausreichend).
- Kein neues KI-Modell, keine neuen Secrets.

## Erwartetes Ergebnis
- Neue Prognosen (manuell und Auto-18:00) enthalten zuverlässig Nominalstil; bei Verstoss greift der bestehende Retry.
- Bestehende Prognose `5f73dd4b-…` muss neu generiert werden, damit der Effekt sichtbar wird.
