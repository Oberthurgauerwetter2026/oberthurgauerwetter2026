## Ziel
Umstellung der KI-Textgenerierung vom Lovable AI Gateway auf die **Google Gemini API direkt** (Free-Tier nutzbar, ~kostenlos für 1× täglich Forecast).

## Was sich ändert

Beide `generateText`-Funktionen rufen aktuell `https://ai.gateway.lovable.dev/v1/chat/completions` mit `LOVABLE_API_KEY` und Modellen `google/gemini-2.5-pro` bzw. `google/gemini-2.5-flash` auf.

Neu: Aufruf des nativen Google-Endpunkts `https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent` mit einem neuen Secret `GEMINI_API_KEY`.

**Fallback-Logik:** Wenn `GEMINI_API_KEY` gesetzt ist → Google direkt. Sonst → Lovable AI Gateway wie bisher. So bleibst du flexibel falls das Free-Tier mal überschritten wird.

## Umzusetzende Schritte

1. **API-Key besorgen** (du, einmalig):
   - https://aistudio.google.com/app/apikey öffnen
   - "Create API key" → in einem Google-Cloud-Projekt erstellen
   - Schlüssel kopieren

2. **Secret `GEMINI_API_KEY` hinzufügen** (Lovable fragt dich danach via add_secret-Tool)

3. **Neue Hilfsfunktion `callGemini()`** in beiden Dateien:
   - `src/server/forecast.functions.ts` (Z. 1885–1917)
   - `src/server/forecast.auto.ts` (Z. 491–505)
   
   Mappt das OpenAI-Format (system/user messages) auf Gemini-REST-Format:
   - `systemInstruction.parts[0].text` ← systemPrompt
   - `contents[0].parts[0].text` ← userPrompt
   - `generationConfig.temperature` 0.2 / `topP` 0.9
   - Antwort aus `candidates[0].content.parts[0].text` extrahieren

4. **Modell-Mapping**:
   - `google/gemini-2.5-pro` → `gemini-2.5-pro`
   - `google/gemini-2.5-flash` → `gemini-2.5-flash`

5. **Fehlerbehandlung**:
   - 429 (Rate-Limit Free-Tier) → freundliche Meldung „Tageslimit erreicht, bitte später"
   - 403/401 → „API-Key ungültig"
   - Bei Netzwerk-/sonstigem Fehler → Fallback auf Lovable AI Gateway versuchen

6. **`generateText`-Wrapper** prüft `process.env.GEMINI_API_KEY` und ruft entsprechend Google direkt oder Lovable AI auf — keine weiteren Code-Änderungen nötig (selbe Signatur).

## Hinweise zu Free-Tier-Limits (Stand Anfang 2026)
- **Gemini 2.5 Flash**: ~10 RPM, 250 Requests/Tag — locker ausreichend für deinen Use Case
- **Gemini 2.5 Pro**: ~5 RPM, 100 Requests/Tag — auch ausreichend, aber knapper bei manueller Mehrfachgenerierung
- Daten werden im Free-Tier von Google zum Modelltraining verwendet — bei Bedarf kostenpflichtigen Tier aktivieren

## Geänderte Dateien
- `src/server/forecast.functions.ts` — `generateText` erweitern
- `src/server/forecast.auto.ts` — `generateText` erweitern

## Nicht geändert
- Prompts, Forecast-Logik, UI, Datenbank — alles bleibt identisch
- Lovable AI Gateway bleibt als Fallback erhalten