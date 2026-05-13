## Problem

Im KI-Text erscheint die widersprüchliche Phrase „In der Nacht meist klar, **teils sonnig**." Sonnen-Vokabular („sonnig", „heiter", „freundlich", „Sonnenschein", „Aufhellungen") gehört nicht in einen Nacht-Kontext (Sonne steht unter dem Horizont).

Aktuell gibt es keine Regel und keinen Post-Check, der diese Kombination unterbindet — weder im Prompt (`DEFAULT_SKY_RULES`) noch in `nominal-style.server.ts`.

## Lösung

Zweistufig: (1) explizite Prompt-Regel, damit das Modell es gar nicht erst produziert, (2) deterministischer Post-Validator mit 1× Retry — analog zum bestehenden Nominalstil-Mechanismus.

### 1. Prompt-Regel ergänzen (`src/server/forecast.functions.ts`, in `DEFAULT_SKY_RULES`)

Neuer Absatz nach der bestehenden „VERBOTS-KLAUSEL kein sonnig":

> **TAGESZEIT-KONSISTENZ (Sonne nur tagsüber):** In Sätzen oder Satzteilen, die einen Nacht-Kontext beschreiben (Trigger: „in der Nacht", „nachts", „in der ersten/zweiten Nachthälfte", „gegen Mitternacht", „in den frühen Morgenstunden vor Sonnenaufgang", „am späten Abend nach Sonnenuntergang"), sind die Wörter „sonnig", „teils sonnig", „recht/meist/ziemlich sonnig", „heiter", „freundlich", „Sonnenschein", „Aufhellungen", „sonnige Lücken", „Wolkenlücken" ABSOLUT VERBOTEN. Erlaubt sind stattdessen: „klar", „meist klar", „sternenklar", „gering bewölkt", „wolkenlos", „aufgelockerte Bewölkung", „stark bewölkt", „bedeckt", „Nebel-/Hochnebelfelder". Beispiel falsch: „In der Nacht meist klar, teils sonnig." → richtig: „In der Nacht meist klar, nur vereinzelt dünne Wolkenfelder."

### 2. Post-Validator + Retry (`src/server/nominal-style.server.ts`)

Neue exportierte Funktion `enforceNightSunConsistency(text)` analog zu `enforceNominalStyle`:

- Splittet den Text in Sätze/Halbsätze (`/[.!?]|\s-\s/`).
- Für jeden Satz, der einen Nacht-Trigger enthält (`/\b(in der Nacht|nachts|nachthälfte|gegen Mitternacht|nach Sonnenuntergang|vor Sonnenaufgang)\b/i`), prüft auf verbotene Sonnen-Wörter (`/\b(sonnig|heiter|freundlich|Sonnenschein|Aufhellungen?|sonnige Lücken|Wolkenlücken)\b/i`).
- Liefert `{ violations: string[] }` mit den gefundenen Problemphrasen.

In `generateTextNominal` einbauen: nach dem bestehenden Nominalstil-Check zusätzlich Night-Sun-Check; bei Verstoß genau 1× Retry mit angehängter Anweisung:

> WICHTIG: Im vorherigen Versuch wurde im Nacht-Kontext Sonnen-Vokabular verwendet ("…"). Schreibe ZWINGEND ohne „sonnig/heiter/freundlich/Sonnenschein/Aufhellungen" sobald die Nacht beschrieben wird. Verwende stattdessen „klar/meist klar/sternenklar/gering bewölkt/stark bewölkt/bedeckt/Nebel".

Bestehender Nominalstil-Retry bleibt unverändert; die beiden Checks werden gemeinsam ausgewertet (ein Retry, der beide Hinweise enthält, falls beide verletzt sind).

## Technische Details

- Datei 1: `src/server/forecast.functions.ts` — nur Konstante `DEFAULT_SKY_RULES` erweitern (ein neuer Absatz). Kein Verhalten an anderer Stelle berührt.
- Datei 2: `src/server/nominal-style.server.ts` — `enforceNightSunConsistency` hinzufügen, `generateTextNominal` so anpassen, dass beide Validatoren in einem kombinierten Retry münden (statt zwei getrennten Retry-Runden, um die Modell-Calls minimal zu halten).
- Keine DB-, Cron- oder UI-Änderungen.

## Erwartetes Resultat

Sätze wie „In der Nacht meist klar, teils sonnig" werden bereits vom Modell vermieden (Prompt-Regel) und im Restfall vom Validator abgefangen + automatisch durch eine konsistente Nacht-Formulierung ersetzt.
