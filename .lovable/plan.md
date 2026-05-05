## Diagnose

Die Meldung „Cannot coerce the result to a single JSON object" stammt von PostgREST und tritt auf, wenn `.single()` **0** (oder mehr als 1) Zeilen zurückbekommt. Im Code wird `.single()` an drei Stellen verwendet:

1. **`src/routes/_app.forecast.$forecastId.tsx:54`** — beim Laden der Prognose im Editor. Wenn die Forecast-ID in der URL nicht (mehr) existiert (z. B. nach Löschen, oder weil eine andere Browser-Tab-Instanz parallel regeneriert hat), knallt es genau hier.
2. `src/server/forecast.functions.ts:2353` — direkt nach `.insert(...).select().single()`. Selten kritisch, weil insert sicher 1 Zeile zurückgibt.
3. `src/server/forecast.functions.ts:2611` — beim WordPress-Publish per ID.

In der DB existieren aktuell mehrere Forecast-Zeilen für 2026-05-05 — wenn eine davon mitten in einem Workflow weggeräumt wird (Cleanup nach KI-Fehler, Delete via Dashboard), liefert die nachfolgende `.single()`-Abfrage 0 Zeilen → genau die Fehlermeldung.

## Plan

### 1. `src/routes/_app.forecast.$forecastId.tsx` — robust laden
- `.single()` → `.maybeSingle()` umstellen.
- Wenn `f` null ist und kein Fehler vorliegt: freundliche Toast-Meldung „Prognose nicht gefunden – evtl. wurde sie gerade gelöscht oder neu generiert." anzeigen und einen „Zurück zum Dashboard"-Hinweis im UI rendern.
- Bestehende UI für „leere Einträge" bleibt unberührt.

### 2. `src/server/forecast.functions.ts:2611` — Publish-Lookup absichern
- `.single()` → `.maybeSingle()` mit klarem Fehler-Throw „Prognose nicht mehr vorhanden" statt PostgREST-Coerce-Meldung.

### 3. `src/server/forecast.functions.ts:2353` — Insert-Result
- Hier ist `.single()` korrekt (Insert garantiert 1 Zeile). Belassen, aber Fehlerausgabe um den Hinweis ergänzen, falls künftig RLS o. Ä. zuschlägt.

### Was nicht passiert
- Keine DB-Migrationen.
- Keine Änderung am Generierungs-/Cleanup-Flow.

Sobald freigegeben, setze ich 1–3 um.
