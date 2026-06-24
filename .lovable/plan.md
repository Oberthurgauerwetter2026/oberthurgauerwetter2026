## Was aktuell pro Prognose passiert

Pro „Prognose generieren" laufen bis zu **7 parallele KI-Calls** über Lovable AI Gateway (`google/gemini-2.5-flash`):

- 1× „Heute" / „Heute Abend & Nacht"
- 5× Tag 1 – 5
- 1× Trend Tag 6 – 10

Jeder Call kann zusätzlich **1× Retry** auslösen, wenn `enforceNominalStyle` / `enforceNightSunConsistency` Verstöße findet. Worst-Case: **14 Calls pro Prognose**. Jeder Call zieht Credits aus deinem Workspace — deshalb war das Guthaben aufgebraucht.

## Ziel

Kosten pro Prognose senken durch (1) Prompt-Cache, damit identische Eingaben keine neuen Calls auslösen, und (2) ein günstigeres, gleich schnelles Modell.

## Änderungen

### 1. KI-Antwort-Cache (`ai_text_cache`-Tabelle)

Neue Tabelle `public.ai_text_cache` mit Migration:
- `cache_key text primary key` — SHA-256 über `model + systemPrompt + userPrompt`
- `content text not null`
- `created_at timestamptz default now()`
- `expires_at timestamptz not null`
- RLS + Grants nach Standard (nur `service_role`, kein `anon`/`authenticated` — Cache ist server-intern).

Wrapper in `forecast.functions.ts` um `generateText(...)`:
- Key = `sha256(model || '\n' || systemPrompt || '\n' || userPrompt)`
- Lookup über `supabaseAdmin` (dynamisch im Handler importiert).
- Treffer → Antwort sofort zurück, **0 Credits**.
- Miss → bestehender Gateway-Call, Ergebnis mit TTL **24 h** speichern.

Warum 24 h: Prompts enthalten konkrete Open-Meteo-Zahlen pro Tag. Solange der R2-Ingest-Cache dieselben Werte liefert (er läuft alle paar Stunden via GitHub Action), liefert das Modell deterministisch denselben Text → identischer Hash → Cache-Treffer. Sobald sich die Wetterdaten ändern, ändert sich der Hash automatisch.

Effekt:
- **Zweite Prognose mit denselben Daten = 0 Credits.**
- Nur die Einträge, deren Wetterdaten sich seit letztem Ingest geändert haben, kosten neu.
- „Regenerieren" direkt nach „Generieren" (häufiger Fall beim Korrekturlesen) ist kostenlos.

### 2. Günstigeres Modell

Wechsel `google/gemini-2.5-flash` → `google/gemini-3.1-flash-lite` in `generateText()` (Zeile 2961).

`flash-lite` ist auf Klassifikation / Extraktion / strukturierte Textgenerierung mit klaren Vorgaben ausgelegt — passt zum streng formatierten Nominal-Stil-Prompt. Deutlich günstiger pro Call, vergleichbare Latenz.

Falls die Qualität spürbar abfällt (mehr Nominal-Style-Retries), Fallback auf `google/gemini-3-flash-preview` (Lovable-Default) — als einzeilige Konstante oben in der Datei, damit Wechsel trivial bleibt.

### 3. Retry-Logik leicht entschärfen

In `nominal-style.server.ts` ist der Retry-Trigger aktuell `violations.length < 1` (also: bei jeder einzelnen Verletzung Retry). Schwelle auf `>= 2` Verletzungen anheben — einzelne Bagatellen kosten dann keinen zweiten Call. Spart bei ~30 % der Calls den Retry.

## Was bewusst NICHT geändert wird

- Anzahl Einträge (7) bleibt — Konsolidierung würde die UX verändern und ist explizit nicht gewünscht.
- Promptstruktur bleibt unverändert.
- Bestehende `weather_cache`-Mechanik bleibt unangetastet.

## Technische Details

- Tabelle via `supabase--migration` anlegen (inkl. GRANT + RLS-Block).
- `ai_text_cache`-Lookups: Read & Write über `supabaseAdmin` aus `client.server`, **dynamisch importiert** im `generateText`-Handler (Server-only Boundary, kein Leak in Client-Bundle).
- Cleanup: kleine `delete from ai_text_cache where expires_at < now()` direkt vor Insert — kein Cron nötig.
- Logging: ein `console.log("[ai-cache] hit/miss", key.slice(0,8))` zur Beobachtbarkeit.

## Erwarteter Effekt

| Szenario | Vorher | Nachher |
|---|---|---|
| Erste Prognose des Tages | 7 – 14 Calls (flash) | 7 – 10 Calls (flash-lite, ~1/3 Preis) |
| Regenerieren ohne neue Wetterdaten | 7 – 14 Calls | **0 Calls** |
| Regenerieren nach neuem Ingest (~1 Tag/Strecke) | 7 – 14 Calls | nur geänderte Einträge |

Grobe Schätzung: **60 – 90 % weniger Credit-Verbrauch** im typischen Tagesablauf (mehrfaches Prüfen / Regenerieren).
