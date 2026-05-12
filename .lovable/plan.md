## Diagnose

Beim manuellen Erzeugen läuft `fetchGrids` 14 Batches à 100 Koordinaten mit nur 250 ms Pause. Open‑Meteo erlaubt ~600 Calls/Minute, aber durch parallel laufende Hintergrundjobs (`forecast.auto`, `synoptic_trend`, `pressure_gradient`, …) wird der **minutely** Bucket schnell voll. Die ersten Batches laufen, ab Batch ~6–8 kommt `429 minutely`.

Die aktuelle Retry‑Logik (500 / 1500 / 4500 ms) ist viel zu kurz für `minutely` — Open‑Meteo selbst sagt "try again in one minute". Wenn dann ≥50 % der Batches in einem Lauf 429 lieferten, schreibt der Code einen Negative‑Cache‑Eintrag (`om:ratelimit:pressure-map`, Tier `minutely`, 2 min TTL) und wirft `OpenMeteoRateLimitError`. Der Button zeigt deshalb genau den Status, den du siehst:

> Pausiert: Open-Meteo Rate-Limit (auto-retry sobald frei)

Bestätigt durch DB:
- `weather_cache.om:ratelimit:pressure-map` → `tier: minutely`, expires nach 2 min
- `openmeteo_usage` heute: `pressure_map: 44` Calls (≙ ein erfolgreicher Versuch + ein abgebrochener Lauf mit Retries)

Es ist **kein** Tageslimit (Limit 10000, heute Total 58).

## Lösung

Drei kleine, gezielte Änderungen, alle in `src/server/pressure-map.server.ts`:

### 1. Burst entzerren

`BATCH` auf 50 verkleinern und die Pause zwischen Batches von 250 ms → **1100 ms** erhöhen. Damit liegen ~28 Batches × 1.1 s ≈ 31 s pro Lauf, sicher unter dem Minute‑Limit auch wenn parallel andere Jobs laufen.

### 2. Echter „1‑Minute"-Backoff bei `minutely`

Im Retry‑Loop von `fetchGrids` (Zeilen 142‑180) bei `lastTier === "minutely"` den nächsten Versuch erst nach **65 s** statt 500 ms / 1500 ms machen, und auf bis zu **4 Versuche** erhöhen (heute 3). Bei `5xx` und Netzwerkfehler bleibt der schnelle Backoff.

### 3. Negative‑Cache nur bei `hourly` / `daily`

Den Block bei Zeilen 209‑212 (`if total429 >= attempted/2 → setRateLimited`) so anpassen, dass er **bei `minutely` nicht** den 2‑Minuten‑Marker setzt — minutely heilt sich durch (1) und (2) selbst. Stattdessen einfach einen klar getypten Fehler `INSUFFICIENT_DATA` werfen (oder den vorhandenen "Zu wenige gültige Druckwerte"‑Pfad nutzen), den der Hook bereits als `Transient: … — auto-retry beim nächsten Cron‑Slot` behandelt. Manueller Button‑Klick zeigt dann einen ehrlichen "Daten unvollständig"-Status statt des irreführenden "Tageslimit"-Wordings.

Hourly‑ und Daily‑Pfade bleiben unverändert (echte Limits sollen weiterhin gemerkt werden).

## Nicht im Scope

- Kein Modellwechsel, kein Caching‑Bypass, keine UI‑Änderung.
- Keine Reduktion paralleler Hintergrundjobs.
- Keine Migration nötig — alles in einer Datei.

## Erwartetes Ergebnis

- Manueller "Karte erzeugen"-Klick läuft ~30 s durch und liefert die Karte, auch wenn parallel `forecast.auto` läuft.
- Falls doch ein `429 minutely` kommt, wartet der betroffene Batch 65 s und probiert erneut — der Lauf bleibt erfolgreich.
- Die irreführende "Tageslimit"-Meldung verschwindet im Minutely‑Fall.
