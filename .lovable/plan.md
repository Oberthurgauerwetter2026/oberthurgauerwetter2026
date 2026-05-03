## Problem

Der KI-Prompt enthält keine explizite Anweisung zum **Nominalstil** — daher mischt das Modell Verbal- und Nominalphrasen. Die Referenzbeispiele sind ebenfalls gemischt formuliert und verstärken das Verhalten.

## Änderung

In `src/server/forecast.functions.ts` (Konstante `DEFAULT_GENERAL_STYLE`, ca. Zeile 937–950):

1. **Neue Stilregel hinzufügen** (direkt unter „Sachlich, nüchtern, präzise …"):
   > „**NOMINALSTIL**: Schreibe konsequent im Nominalstil — verb-arm, mit Substantiv-Phrasen statt Vollverben. Vermeide finite Verben, wo eine Nominalphrase reicht. Hilfsverben („sein", „werden", „bleiben") nur, wenn unumgänglich."

2. **Erweiterte Verbots-Liste** in der bestehenden VERBOTEN-Zeile:
   - „zeigt sich", „präsentiert sich", „gestaltet sich"
   - „der Himmel ist …", „das Wetter wird …"
   - generell Vollverben wie „regnen", „scheinen", „aufziehen" als finite Form (stattdessen: „Regen", „Sonnenschein", „Aufzug von Wolkenfeldern")

3. **Referenzbeispiele in `STRUCTURE_AND_EXAMPLES` (Zeile 993–1011) anpassen**, sodass beide Beispiele konsequent im Nominalstil sind. Beispielhafte Umformulierung:
   - Vorher: „Im Laufe der zweiten Nachthälfte weitere Bewölkungsverdichtung - gegen den Morgen erste Schauer …" (bereits gut)
   - Vorher: „Am Sonntag veränderlich bewölkt und gelegentlich Schauer …" (gut, bleibt)
   - Anpassen: „Höchstwerte um 18 Grad." → bleibt
   - Schwachstelle: „in Verbindung mit Schauer und Gewitter kräftige Böen." → ist bereits Nominalstil ✓

   Das **kurze Beispiel** ist bereits sehr gut. Hauptarbeit: kleine Glättung im langen Beispiel + zusätzliches **Negativ-Beispiel** einfügen:
   > „FALSCH (Verbalstil — vermeiden): „Am Morgen scheint die Sonne, später ziehen Wolken auf und es regnet zeitweise."
   > RICHTIG (Nominalstil): „Am Morgen sonnig, im Tagesverlauf Aufzug von Wolkenfeldern - zeitweise Regen."

## Scope

- Nur Prompt-Text, keine Logik/Schema-Änderung.
- Gilt für beide Codepfade (manueller `forecast.functions.ts` + `forecast.auto.ts` nutzt dieselbe `buildSystemPrompt`-Funktion → automatisch abgedeckt).
- Bestehende Stilregeln (Halbsätze mit „ - ", Pflicht-Vokabular, Wind-Label-Zwang) bleiben unverändert.

## Hinweis

Falls der Effekt nach dem Update noch nicht stark genug ist, wäre ein Wechsel auf `google/gemini-2.5-pro` oder `openai/gpt-5-mini` (bessere Befolgung komplexer Stilanweisungen) der nächste Hebel — aber zuerst die Prompt-Änderung testen.
