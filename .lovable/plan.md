## Diagnose

Der Hook bzw. Server-Function-Aufruf zur Bodendruckkarte läuft länger als das Edge-Timeout (~30 s) und der Lovable-Proxy bricht mit **„upstream request timeout"** ab.

Aktuelle Wallzeit:
- 28 Batches × `await sleep(1100ms)` zwischen den Batches = mind. **~30 s nur Pause**
- plus pro Batch ~200–800 ms tatsächliche Open-Meteo-Antwort
- → realistisch **35–50 s** pro Lauf, also strukturell über dem Edge-Timeout.

Die 1.1 s Pause hatten wir eingeführt, um den **per-minute** Bucket nicht zu überlasten — sie löst das Problem aber auf Kosten der Gesamtlaufzeit. Open-Meteo erlaubt ~600 Calls/min; bei 28 Batches sind wir mit beliebigem Pacing weit darunter, sobald wir die Calls **parallelisieren** statt seriell zu warten.

## Lösung

Eine einzige Datei: `src/server/pressure-map.server.ts`, Funktion `fetchGrids`.

### 1. Sequenziellen Loop durch Concurrency-Pool ersetzen

`for` mit `await sleep(1100)` ersetzen durch einen kleinen Worker-Pool mit **Concurrency = 4**. Jeder Worker zieht den nächsten Batch-Index aus einer Queue und macht den Open-Meteo-Call. Keine künstliche Pause mehr zwischen Batches.

Erwartete Wallzeit: 28 Batches / 4 Worker ≈ 7 Wellen × ~500 ms ≈ **3–6 s** — sicher unter dem 30 s-Edge-Timeout, immer noch deutlich unter 600 Calls/min (Peak ≈ 4 Calls parallel × 60/0.5 = ~480/min worst‑case, real eher ~280/min).

### 2. Retry-Logik beibehalten

Pro Batch bleibt:
- bei `5xx` / Netzwerk-Fehler: schneller Backoff (500 / 1500 / 4500 ms)
- bei `429 minutely`: 65 s Wait (selbstheilend, blockiert nur diesen Worker — die anderen 3 laufen weiter)
- bei `429 hourly`: 30 min Wait → Wait wäre länger als das Edge-Timeout, deshalb brechen wir hier nach **einem** 429-hourly-Treffer ab und werfen wie bisher `OpenMeteoRateLimitError` (Marker hourly setzen).
- bei `429 daily`: nach 3 in Folge → `OpenMeteoRateLimitError` mit daily-Marker (unverändert).

Counter (`consecutive429`, `total429`, `attempted`) werden über einen kleinen geteilten Zustand zwischen den Workern aktualisiert — atomar reicht hier `let` mit Inkrementen, da JS single-threaded ist.

### 3. Optional: Abort-Guard (defensive)

Vor dem Schreiben in Storage einmal prüfen: wenn der gesamte Lauf jetzt >25 s wallclock dauerte, im Log warnen (nicht abbrechen). Hilft beim Erkennen, falls Open-Meteo plötzlich langsamer wird.

## Was sich NICHT ändert

- Kein Schema-Change, keine Migration.
- Kein neuer Quota-Verbrauch — gleiche Anzahl Open-Meteo-Calls pro Lauf (28 Batches × 50 Punkte).
- SVG-Erzeugung, Storage-Upload, Hook-Auth, UI bleiben unverändert.
- ECMWF/GFS-Synoptik-Trend (vorherige Änderung) bleibt unverändert.

## Erwartetes Ergebnis

- Manueller "Karte erzeugen"-Klick antwortet in **~5–8 s** (Fetch + SVG-Build + Upload), kein „upstream request timeout" mehr.
- Cron-Lauf identisch schnell, weniger anfällig für Edge-Timeouts.
- Bei einem `minutely 429` blockiert nur der betroffene Worker für 65 s; falls die Gesamtzeit dadurch trotzdem >30 s wird, schlägt der Lauf wie bisher fehl — passiert dann aber nur, wenn parallel ein anderer großer OM-Job läuft.