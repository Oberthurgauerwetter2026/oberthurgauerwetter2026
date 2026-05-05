# Fix: 504 "upstream request timeout" bei Prognose-Generierung

## Ursache
`generateForecast` macht 6–7 parallele AI-Calls (Tag 0–5 + Trend) an `google/gemini-2.5-pro` über das Lovable-AI-Gateway. Das Gateway logt für jeden Call:

```
[ai] Gemini nicht verfügbar (Gemini Free Tageslimit (429.)) – Fallback auf Lovable AI.
```

Jeder Call kostet dadurch ~3–5 s zusätzliche Wartezeit (erst Gemini-Free probieren → 429 → Fallback). Bei 7 parallelen Calls + möglichem Style-Retry summiert sich die Latenz über das Gateway-Timeout (~60 s) → **504**.

## Umsetzung

**1. Modellwechsel in `src/server/forecast.functions.ts` (`generateText`, ~Zeile 1106)**
- Von `google/gemini-2.5-pro` auf **`google/gemini-2.5-flash`**.
- Flash ist deutlich schneller, hat keinen Free-Tier-Engpass und liefert für Wettertexte genügend Qualität. Damit entfallen die Fallback-Loops im Gateway.

**2. Abort-Timeout nachziehen (~Zeile 1095)**
- Aktuell 45 s pro Call → für Flash auf 30 s reduzieren (schnellerer Failure-Modus, falls ein Call hängt).

**3. Style-Retry konditional machen (`generateTextNominal`, ~Zeile 172)**
- Aktuell: bei jedem erkannten Verstoß ein zweiter voller AI-Call.
- Neu: nur retryen, wenn die Verstoß-Anzahl ≥ 2 ist (einzelne Hilfsverb-Treffer akzeptieren). Spart im Schnitt ~1 Extra-Call pro Generierung.

## Test
Nach dem Deploy im Dashboard "Neue Prognose generieren" klicken — sollte in ~15–30 s durchlaufen, kein 504 mehr.

## Optional / später
Falls die Qualität von Flash nicht reicht: pro Tagesblock individuell wählen (Tag 1–2 mit Pro, Tag 3–5 + Trend mit Flash) oder auf `google/gemini-3-flash-preview` upgraden.
