## Ziel
`GEMINI_API_KEY` ist gesetzt. Beide `generateText`-Funktionen so erweitern, dass sie bevorzugt direkt Google Gemini API aufrufen und Lovable AI nur als Fallback nutzen.

## Änderungen

### 1. `src/server/forecast.functions.ts` (Z. 1885–1917)
`generateText` umstrukturieren:
- Wenn `process.env.GEMINI_API_KEY` gesetzt → `callGemini("gemini-2.5-pro", ...)`
- Bei 429/403/401 von Google → freundliche Fehlermeldung
- Bei Netzwerkfehler → Fallback auf Lovable AI Gateway (bestehender Code)
- Wenn kein `GEMINI_API_KEY` → direkt Lovable AI Gateway

Neue Helper-Funktion `callGemini(model, systemPrompt, userPrompt)`:
- POST an `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`
- Body: `{ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: userPrompt }] }], generationConfig: { temperature: 0.2, topP: 0.9 } }`
- 45s Timeout via AbortController (wie bisher)
- Antwort aus `candidates[0].content.parts[0].text`
- Fehler-Mapping:
  - 429 → `"KI-Tageslimit (Gemini Free) erreicht. Bitte später erneut versuchen."`
  - 401/403 → `"Gemini API-Key ungültig."`
  - sonst → wirft Error mit Status (löst Fallback aus)

### 2. `src/server/forecast.auto.ts` (Z. 491–505)
Identische Logik mit Modell `gemini-2.5-flash` (statt pro). Helper-Funktion `callGemini` dort lokal duplizieren (gleiche Signatur).

## Verhalten
- Solange Gemini Free-Tier reicht (250 Req/Tag Flash, 100 Req/Tag Pro): kostenlos
- Bei Limit/Ausfall: automatischer Fallback auf Lovable AI Gateway (sofern `LOVABLE_API_KEY` vorhanden und Guthaben da)
- Keine Änderungen an Prompts, UI, DB, Forecast-Logik

## Geänderte Dateien
- `src/server/forecast.functions.ts`
- `src/server/forecast.auto.ts`
