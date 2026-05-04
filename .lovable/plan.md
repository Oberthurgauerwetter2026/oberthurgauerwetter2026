## Problem
Die Meldung „KI-Guthaben aufgebraucht. Bitte Workspace aufladen." erscheint weiterhin, obwohl `GEMINI_API_KEY` gesetzt ist und der Code Gemini bevorzugt aufrufen sollte.

## Ursache
Mein letzter Fix hat einen **stillen Fallback** auf Lovable AI eingebaut: Wenn der Gemini-Aufruf aus irgendeinem Grund scheitert (z.B. Modellname `gemini-2.5-pro` wird von der v1beta-API nicht akzeptiert, Netzwerkfehler, unerwartete Antwortstruktur), wird automatisch auf Lovable AI umgeschwenkt — und dort liefert der Provider `402 KI-Guthaben aufgebraucht`. Die Original-Meldung von Gemini geht im `console.warn` unter und du siehst nur den Lovable-AI-Fehler.

Zudem: `gemini-2.5-pro` ist in `v1beta` ggf. nicht direkt verfügbar — der korrekte Modell-Identifier ist oft `gemini-2.5-pro` ODER `gemini-2.5-pro-latest` ODER `gemini-2.0-flash-exp`. Der Free-Tier unterstützt **`gemini-2.5-flash`** garantiert, **`gemini-2.5-pro`** dagegen nur eingeschränkt.

## Fix

### 1. `src/server/forecast.functions.ts` — `generateText` (Z. 1946–1958)
Stillen Fallback entfernen. Wenn `GEMINI_API_KEY` gesetzt ist → ausschliesslich Gemini, Fehler werden direkt an den Aufrufer durchgereicht (echte Fehlermeldung sichtbar):

```ts
async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
  if (process.env.GEMINI_API_KEY) {
    return await callGemini("gemini-2.5-flash", systemPrompt, userPrompt);
  }
  return await callLovableAI("google/gemini-2.5-pro", systemPrompt, userPrompt);
}
```

### 2. Modell-Wechsel auf `gemini-2.5-flash` (beide Dateien)
- `forecast.functions.ts` Z. 1949: `gemini-2.5-pro` → `gemini-2.5-flash`
- `forecast.auto.ts` bleibt bei `gemini-2.5-flash` (schon korrekt), aber auch dort den stillen Fallback entfernen

**Begründung Modellwahl:** `gemini-2.5-flash` ist im Free-Tier mit 250 Req/Tag stabil verfügbar und liefert für Wettertexte mehr als ausreichende Qualität. Falls du später bewusst Pro-Qualität willst, kannst du auf `gemini-2.5-pro` umstellen — dann aber im Wissen, dass das Free-Limit dort nur 100 Req/Tag beträgt und teilweise gar nicht im Free-Tier verfügbar ist.

### 3. `forecast.auto.ts` `generateText` (Z. 529–539)
Gleicher Fix: kein stiller Fallback mehr.

## Verifikation nach dem Fix
- Forecast neu generieren
- Falls weiterhin Fehler: die echte Gemini-Fehlermeldung wird jetzt angezeigt (z.B. „Gemini-Fehler 404: model not found" → dann wechseln wir auf einen anderen Modellnamen)

## Geänderte Dateien
- `src/server/forecast.functions.ts`
- `src/server/forecast.auto.ts`
