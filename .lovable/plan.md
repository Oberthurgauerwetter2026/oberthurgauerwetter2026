## Diagnose

Die Logs und die DB-Daten zeigen klar, was passiert:

1. **Gemini Free** ist heute auf 429 (Tageslimit). Server-Log:
   `[ai] Gemini nicht verfügbar (Gemini Free Tageslimit (429).) – Fallback auf Lovable AI.`
2. Der Fallback auf **Lovable AI** schlägt anschließend mit **HTTP 402** fehl. Das wird wörtlich als
   `KI-Guthaben aufgebraucht (Lovable AI). Bitte Workspace aufladen.` an den Client durchgereicht.
3. Beim ersten fehlgeschlagenen Versuch wurde **die Prognose-Zeile aber bereits angelegt** (`forecasts` enthält Eintrag für 2026-05-05), nur `forecast_entries` ist leer. Daher:
   - „Neue Prognose generieren" → 402-Fehler (echte KI-Sperre).
   - „Prognose öffnen" → öffnet die leere Prognose, sieht aus, als ob nichts geht.

Das ist also **kein Bug im Code** — beide KI-Quellen sind aktuell tatsächlich nicht verfügbar (Gemini Free täglich 0, Lovable-AI-Workspace-Guthaben aufgebraucht).

## Was wir trotzdem im Code verbessern

Damit der App-Zustand nicht weiter „verschmutzt" und die Meldung verständlich wird:

### 1. `src/server/forecast.functions.ts` — `generateForecast` transaktional machen
- Erst alle KI-Tasks ausführen, **dann** die `forecasts`-Zeile schreiben. Falls ein Task scheitert: keine leere Prognose mehr in der DB.
- Alternative (kleiner Eingriff): Bei Fehler nach Insert die soeben erstellte `forecasts`-Zeile via `supabaseAdmin` wieder löschen, damit das Dashboard sauber bleibt.

### 2. Klarere Fehlermeldung statt „KI-Guthaben aufgebraucht"
- In `callLovableAI` (sowohl `forecast.functions.ts` als auch `forecast.auto.ts`) bei 402 die Meldung umschreiben auf:
  „Beide KI-Quellen aktuell nicht verfügbar: Gemini Free Tageslimit erreicht und Lovable-AI-Workspace-Guthaben aufgebraucht. Bitte Workspace-Guthaben aufladen oder bis morgen warten (Gemini-Reset)."
- Dieselbe Verbesserung bei 429 von Lovable AI (Rate-Limit).

### 3. Editor-Seite: leere Prognose freundlicher anzeigen
- In `src/routes/_app.forecast.$forecastId.tsx` einen Hinweis einblenden, wenn `entries.length === 0`:
  „Diese Prognose wurde nur teilweise erstellt (KI-Generierung fehlgeschlagen). Bitte unten ‚Komplett neu generieren' oder im Dashboard löschen."

### 4. Bestehende leere Prognose vom 2026-05-05 aufräumen
- Hinweis im Chat: Der vorhandene Entwurf (`0041ddf4-…`) hat keine Einträge. Nach dem Fix kann er im Dashboard mit „Löschen" entfernt werden.

## Was wir nicht tun (und warum)

- **Kein dritter automatischer Fallback**: Es gibt aktuell keinen weiteren konfigurierten Anbieter. Einen OpenAI-Key etc. zu integrieren wäre ein neues Feature und kostet zusätzlich — nur sinnvoll, wenn du das willst.
- **Kein Umweg über andere Lovable-AI-Modelle**: 402 betrifft das Workspace-Guthaben, nicht das Modell. Jedes Modell würde ebenfalls 402 zurückgeben.

## Empfohlener nächster Schritt (außerhalb des Codes)

Damit Generierung **heute** wieder funktioniert:
- Workspace-Guthaben für Lovable AI aufladen: **Settings → Workspace → Usage**, oder
- bis zum Gemini-Free-Tagesreset (UTC-Mitternacht) warten.

Sobald du den Plan freigibst, setze ich die Code-Verbesserungen (1–3) um und nenne dir die ID des leeren Entwurfs zum Löschen (Punkt 4).
