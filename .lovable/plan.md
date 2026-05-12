## Problem

Die Bodendruckkarte wird einmal täglich um 04:30 UTC per pg_cron generiert. Am 12. Mai schlug dieser eine Versuch fehl (`0/1344 gültige Druckwerte` — vermutlich wegen Open‑Meteo `429 minutely` durch parallelen Lastpeak von `forecast.auto.ts`). Da es **keinen Retry** gibt und kein zweiter Cron‑Slot existiert, blieb die Karte für den 13. Mai leer.

## Lösung (3 Schichten)

### 1. Mehrere Cron‑Slots (Selbstheilung)

Statt nur 04:30 UTC zusätzlich um **05:30, 07:30 und 10:30 UTC** triggern. Die bestehende Idempotenz‑Logik (`OK`‑Status enthält bereits `targetDay` → Skip) sorgt dafür, dass nach Erfolg keine weiteren OM‑Calls anfallen. Implementierung via `cron.schedule` SQL über das Insert‑Tool (kein Migration‑File, da projektspezifische URL/Key).

### 2. Retry pro Batch in `fetchGrids` (`src/server/pressure-map.server.ts`)

Aktuell: Batch fehlgeschlagen → `continue` → Werte bleiben NaN.
Neu: Bei nicht‑daily‑Fehlern (Netzwerk, 5xx, 429‑minutely) bis zu **2 Wiederholungen** mit exponentiellem Backoff (500 ms, 1500 ms). Nur echte `daily 429` brechen sofort ab (wie heute).

### 3. Härtere Erfolgsbedingung mit Auto‑Retry des Hooks

Wenn am Ende `validCount < 100`, wird ein klar typisierter Fehler `INSUFFICIENT_DATA` zurückgegeben statt nur `Fehler: ...`. Der Cron‑Slot 05:30/07:30/10:30 läuft dann ohnehin und versucht es erneut, weil die Idempotenz‑Prüfung nur bei `OK` greift.

## Technische Details

- **`src/server/pressure-map.server.ts`** — Retry‑Loop um den `fetchOpenMeteo`‑Call in `fetchGrids` (Zeilen ~140‑168). Maximal 3 Versuche pro Batch. Bei daily‑429 sofortiger Abbruch.
- **`src/routes/api/public/hooks/generate-pressure-map.ts`** — Status‑String bei Insufficient‑Data ergänzen um Hinweis „auto‑retry beim nächsten Cron‑Slot".
- **DB / pg_cron** — drei zusätzliche Schedules `generate-pressure-map-0530`, `-0730`, `-1030`. Bestehender 04:30‑Slot bleibt.

## Nicht im Scope

- Kein Modellwechsel (bleibt `icon_seamless`).
- Kein Caching‑Bypass.
- Keine UI‑Änderungen.
- Kein Eingriff in `forecast.auto.ts` (Lastpeak entzerrt sich durch Retries).

## Erwartetes Ergebnis

Selbst wenn der erste Slot durch transiente OM‑Fehler scheitert, generiert spätestens der 05:30‑Slot die Karte. Bleibt alles erfolgreich, fallen nur die Idempotenz‑Reads an (1 SELECT, keine OM‑Quota).