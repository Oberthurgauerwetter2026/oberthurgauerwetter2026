## Befund

Die neu gespeicherte Prognose enthält nur Position 1–6; der Eintrag „Trend Tag 6 – 10“ wurde gar nicht in `forecast_entries` geschrieben.

Wahrscheinliche Ursache nach dem Cache-Fix: Der Ingest holt jetzt zwar `forecast_days=12`, aber der veröffentlichte/preview-seitige Cache ist noch nicht nachweisbar frisch erreichbar. Zusätzlich ist die Trend-Logik zu still: Wenn nur ein Teil der Tage fehlt, wird der Trend kommentarlos übersprungen statt einen klaren Fehler oder Fallback zu liefern.

## Plan

1. **Cache-Diagnose erweitern**
   - `/api/public/debug/r2-cache` soll zusätzlich anzeigen:
     - wie viele `daily.time` Tage in `phaseA[0]` vorhanden sind
     - erstes/letztes Datum
     - ob mindestens 11–12 Tage für „Trend Tag 6–10“ vorhanden sind
   - Damit sieht man sofort, ob der R2-Cache wirklich schon die 12-Tage-Version enthält.

2. **Trend-Erzeugung robust machen**
   - In `src/lib/forecast.functions.ts` beide Pfade (`generateForecast` und `regenerateForecast`) anpassen:
     - Trend nur erzeugen, wenn genügend reale Tage vorhanden sind.
     - Wenn zu wenig Tage vorhanden sind, eine Warnung loggen mit `todayIdx`, verfügbarer Tagesanzahl und Datumsbereich.
     - Kein stilles `filter(Boolean)` mehr als alleinige Entscheidung.

3. **Auto-Prognose angleichen**
   - `src/server/forecast.auto.ts` auf dieselbe robuste Trend-Auswahl bringen, damit manuelle und automatische Prognosen gleich reagieren.

4. **Kleine Doku-Korrektur**
   - Kommentare von „Tag 0–7“ auf „Tag 0–11“ aktualisieren, damit der Code nicht mehr den alten 7-Tage-Cache suggeriert.

## Validierung

- Cache-Debug-Endpunkt zeigt danach `phaseA_daily_days >= 12` und ein letztes Datum mindestens 10 Tage nach heute.
- Neue Prognose erzeugen/regenerieren: Es wird wieder ein Eintrag mit Titel „Trend Tag 6 – 10“ geschrieben.
- Falls der Cache noch alt ist, zeigt die Diagnose eindeutig, dass erst der Ingest/Deploy/Workflow aktualisiert werden muss.