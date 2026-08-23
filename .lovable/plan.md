# Modellgitter-Ingest beschleunigen

Der Lauf dauert aktuell sehr lange, weil alles streng sequenziell passiert: 9 Modelle × 8 Anfragen (748 Gitterpunkte, je 100 pro Anfrage) mit je 4 Sekunden Zwangspause dazwischen — dazu jede Antwort mit 12 Variablen × 96 Stunden × 100 Punkten. Das summiert sich auf gut 30–40 Minuten.

## Ziel

Gleiche Datenmenge und Auflösung, aber Laufzeit im Bereich weniger Minuten.

## Massnahmen

1. **Ein GitHub-Job pro Modell (Matrix)**
   Statt 9 Modelle nacheinander laufen 9 Jobs parallel. Jeder Job holt nur sein Modell und lädt seine Dateien direkt nach R2 hoch. Damit sinkt die Wanduhr-Zeit auf die Dauer des langsamsten Einzelmodells.

2. **Index-Datei in einem Abschluss-Job**
   Jeder Modelljob schreibt eine kleine Statusdatei (`model-grid/_meta/<model>.json`) nach R2. Ein nachgelagerter Job liest diese ein und baut daraus `model-grid/index.json` — so bleibt der Index konsistent, auch wenn ein Modell ausfällt.

3. **Anfragen innerhalb eines Modells parallelisieren**
   Die 8 Batches eines Modells laufen mit 3 gleichzeitigen Verbindungen statt einzeln; die Pause zwischen den Anfragen sinkt von 4 s auf 1 s. Das bleibt weit unter den Open-Meteo-Limits, weil jeder Job jetzt nur noch 8 statt 72 Anfragen macht.

4. **Nutzlast verkleinern**
   Wind-Variablen und Niederschlagsart in denselben Requests belassen, aber Antwortformat komprimiert anfragen und die Variablenliste pro Modell auf die tatsächlich verfügbaren beschränken (Modelle ohne z. B. Bewölkungsstufen liefern sonst leere Serien, die trotzdem übertragen werden).

5. **Zeitachse robust machen**
   Die gemeinsame Zeitachse wird künftig pro Modell mitgeschrieben und im Abschluss-Job auf den gemeinsamen Nenner gebracht, statt vom ersten erfolgreichen Modell abzuhängen.

## Technische Details

- `scripts/ingest_model_grid.py`: neuer Parameter `MODEL` (ein einzelnes Modell) und `MODE=index`; Batch-Abruf über `ThreadPoolExecutor(max_workers=3)`; `THROTTLE_S` 4.0 → 1.0; Schreiben von `model-grid/_meta/<model>.json` mit `variables`, `times`, `generatedAt`.
- `.github/workflows/model-grid-ingest.yml`: `strategy.matrix.model` mit den 9 Modellen, `fail-fast: false`, `max-parallel: 9`; zweiter Job `index` mit `needs: ingest` und `if: always()`.
- Frontend und `src/routes/api/public/model-grid/$.ts` bleiben unverändert — Dateiformat und Pfade ändern sich nicht.
