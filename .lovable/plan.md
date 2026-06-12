# Fix: Trend Tag 6–10 fehlt nach Cache-Shift

## Ursache

Der R2-Ingest holt nur `forecast_days=7`, also die Tage 0–6 ab Datenstart. Seit dem Shift-Fix (`withTopoShifted(i) = withTopo(todayIdx + i)`) verlangt die Trend-Sektion echte Daten für die Indexe heute+6 … heute+10. Diese Tage liegen ausserhalb des 7-Tage-Caches, das `filter(Boolean)` wirft sie raus, und der Trend-Eintrag wird gar nicht angelegt.

## Änderungen

### 1. `scripts/ingest_openmeteo.py` (Phase A)
- `"forecast_days": 7` → `"forecast_days": 12`
- Bias-Lookback (Phase C) bleibt unverändert.
- Datenmenge steigt moderat (12/7 ≈ +70 % JSON-Grösse, weiterhin gut im R2-Free-Tier).

### 2. GitHub Action manuell triggern
Nach dem Merge den Workflow `Open-Meteo Cache Ingest` einmal manuell laufen lassen, damit der R2-Cache sofort die 12-Tage-Variante enthält. Sonst zeigt die nächste Prognose den Trend erst nach der nächsten 5-Min-Cron-Runde.

### 3. Optional: Robustheits-Hinweis im Code
`forecast.functions.ts` und `forecast.auto.ts` bleiben unverändert — die `filter(Boolean)`-Logik ist bereits defensiv. Sobald der Cache 12 Tage liefert, sind `withTopoShifted(6..10)` immer vorhanden, sogar bei `todayIdx=1` (Cache einen Tag alt).

## Nicht Teil dieses Fixes
- Keine Änderung am Synoptik-Trend-Modul (`synoptic-trend.server.ts`).
- Keine Anpassung der Trend-Indexe (bleiben `[6..10]` bzw. `[5..9]` in `forecast.auto.ts`).
- Keine UI-Änderungen.

## Validierung
1. Nach Ingest: `/api/public/debug/r2-cache` zeigt `age_minutes < 10`.
2. Neue Prognose generieren → Eintrag „Trend Tag 6 – 10" wieder vorhanden.
