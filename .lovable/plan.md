## Problem

Der Nominal-/Telegrammstil wird inkonsistent durchgesetzt. Zwei konkrete Lücken:

1. **`forecast.auto.ts` (Cron-Auto-Generierung) umgeht den Nominal-Check komplett.** Die Datei ruft `generateText()` direkt auf (3×, Zeilen 852, 864, 870) und nicht den Wrapper `generateTextNominal()`. Der existiert nur in `forecast.functions.ts`.

2. **Retry-Schwelle zu hoch.** In `forecast.functions.ts` (Z. 452) wird nur retryt, wenn **≥ 2** Verstöße erkannt werden — Einzel-Verstöße („es regnet" allein, „der Wind weht" allein) rutschen durch.

3. **Pattern-Liste deckt typische Fälle nicht ab.** Es fehlen u.a. „Temperatur steigt/sinkt/fällt", „Wolken ziehen", „Niederschlag fällt", „Schneefallgrenze sinkt/steigt" (statt „sinkend/steigend"), „die Sonne zeigt sich", Hilfsverb-Konstruktionen wie „bleibt", „kommt auf".

## Lösung

### 1. Shared Helper extrahieren

Neue Datei `src/server/nominal-style.server.ts` mit:
- `enforceNominalStyle(text)` — erweiterte Pattern-Liste (siehe unten)
- `generateTextNominal(systemPrompt, userPrompt, generateFn)` — nimmt die Generator-Funktion als Parameter (damit `forecast.auto.ts` und `forecast.functions.ts` ihre eigenen `generateText`-Implementierungen weiterverwenden können)

### 2. `forecast.auto.ts` umstellen

Die drei direkten `generateText(...)`-Aufrufe (Zeilen 852, 864, 870) durch `generateTextNominal(promptTemplate, userPrompt, generateText)` ersetzen.

### 3. `forecast.functions.ts` anpassen

- Lokales `generateTextNominal` und `enforceNominalStyle` durch Import aus dem neuen Helper ersetzen.
- Schwelle von `< 2` auf **`< 1`** senken — jeder einzelne Verstoß löst Retry aus.

### 4. Pattern-Liste erweitern

Zusätzlich zu den bestehenden 11 Mustern:
- `\btemperatur(en)?\s+(steigt|sinkt|fällt|fallen|steigen)\b` → „Temperatur steigt/sinkt"
- `\bwolken\s+ziehen\b` → „Wolken ziehen"
- `\bniederschlag\s+(fällt|fallen)\b` → „Niederschlag fällt"
- `\bschneefallgrenze\s+(sinkt|steigt|fällt)\b` → muss „sinkend/steigend" sein
- `\bdie\s+sonne\s+zeigt\s+sich\b`
- `\bnullgradgrenze\s+(steigt|sinkt|fällt)\b`
- `\b(es|der himmel)\s+bleibt\b`
- `\bkommt?\s+\w+\s+auf\b` → „kommt Wind auf"
- `\bsetzt?\s+\w+\s+ein\b` → „setzt Regen ein"
- Hilfsverb-Konstruktionen ohne ergänzendes Adjektiv: `\bdas\s+wetter\s+(ist|wird|bleibt)\b`

### 5. Logging

Bei jedem Retry weiterhin loggen, welche Verstöße erkannt wurden (existiert schon). Zusätzlich: wenn auch der Retry noch Verstöße enthält, eine Warnung loggen — damit man sieht, dass das Modell den Stil nicht halten kann und die Pattern-Liste oder der System-Prompt nachgeschärft werden müssen.

## Außerhalb des Umfangs

- Keine Änderung am System-Prompt (DEFAULT_GENERAL_STYLE) — der ist bereits ausführlich und führt das gewünschte Beispiel an.
- Keine Änderung am Modell (bleibt `google/gemini-2.5-flash`).
- Keine UI-Änderungen.
