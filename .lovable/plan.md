## Problem

Der GitHub-Action-Ingest (`scripts/ingest_openmeteo.py`) bricht mit `sys.exit()` ab, sobald Open-Meteo einmal HTTP 502 liefert. Das passiert sporadisch (Upstream-nginx), führt aber zu einem roten Workflow-Run und keinem aktualisierten R2-Cache.

## Fix

`fetch()` in `scripts/ingest_openmeteo.py` um Retry-Logik mit Exponential Backoff erweitern:

- Bis zu **4 Versuche** pro Phase
- Retry auf **5xx** (502/503/504) und Netzwerk-/Timeout-Fehler
- Backoff: 2s, 5s, 10s
- Bei 4xx (Client-Fehler) sofort abbrechen, kein Retry
- Nach finalem Fehlschlag: weiterhin `sys.exit()`, damit der Workflow rot wird und die nächste Cron-Ausführung (5 min später) es erneut versucht

Keine weiteren Änderungen — `phase B` und `phase C` profitieren automatisch, da alle drei durch dieselbe `fetch()`-Funktion laufen.

## Datei

- `scripts/ingest_openmeteo.py` — `fetch()` ersetzen, Imports um `time` ergänzen
