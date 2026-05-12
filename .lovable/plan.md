## Ziel

Den Trend Tag 6–10 nicht mehr nur auf **ECMWF IFS 0.25°** stützen, sondern als kleines Ensemble aus **ECMWF IFS + GFS** rechnen. Damit wird die Großwetterlage robuster (zwei unabhängige Globalmodelle), und einzelne Modell-Ausreißer (z. B. eine ECMWF‑Zyklone, die GFS so nicht hat) glätten sich heraus.

## Änderung (eine Datei: `src/server/synoptic-trend.server.ts`)

### 1. Beide Modelle in einem Open-Meteo-Call

In `fetchEuropeMslp` den Parameter

```
models=ecmwf_ifs025
```

ersetzen durch

```
models=ecmwf_ifs025,gfs_global
```

Open-Meteo liefert dann pro Koordinate ein Array mit zwei Einträgen (eines pro Modell). Kein zusätzlicher API-Call, kein zusätzlicher Quota‑Verbrauch — Open-Meteo zählt das als ein Request pro Location.

### 2. Ensemble-Mittel pro Gitterpunkt & Stunde

Rückgabe-Shape von `fetchEuropeMslp` bleibt gleich (`{ times, perPoint: [{ lat, lon, pressure: number[] }] }`), aber `pressure[i]` wird zum **arithmetischen Mittel der beiden Modelle** an dieser Stunde:

- Wenn beide Werte finite → Mittel.
- Wenn nur einer finite → diesen Wert nehmen (Modell-Ausfall toleriert).
- Wenn keiner → `NaN` (wird in `findExtrema`/`flowAtAlps` ohnehin gefiltert).

Damit funktionieren die nachgelagerten Funktionen (`findExtrema`, `flowAtAlps`, Aggregation, Regime-Change-Detection) **ohne weitere Änderung** auf dem Ensemble-Mittel.

### 3. Telemetrie / Logging

Ein kleiner Log-Hinweis, wie viele Locations pro Modell Daten geliefert haben (nur bei Mismatch), damit ein stiller Modellausfall in den Edge-Function-Logs sichtbar wird. Keine UI-Änderung.

## Was sich NICHT ändert

- Kein neuer Request, kein zusätzlicher Quota-Verbrauch (Open-Meteo `models=a,b` ist 1 Request pro Location).
- Kein Schema-Change, keine Migration.
- LLM-Prompt (`buildTrendUserPrompt`) bleibt identisch — er sieht weiterhin nur `synoptic.dominant_low/high/flow_alps`, jetzt eben aus dem ENS-Mittel.
- Keine Änderung an `forecast.auto`, `pressure-map`, `pressure-gradient` etc.
- Cache-Key (`synoptic-trend-${date}`) bleibt — beim ersten Aufruf nach dem Deploy wird er einmal neu befüllt.

## Optional (nicht im Scope, nur falls gewünscht)

- Zusätzlich `icon_seamless` (DWD ICON) als drittes Modell aufnehmen → echtes 3‑Modell-Ensemble. Wäre weiterhin 1 Request pro Location.
- "Spread"-Indikator: Standardabweichung der Modelle pro Tag als Maß für die Vorhersage-Unsicherheit, im Prompt als „hohe/niedrige Modellübereinstimmung" angeben.

Sag Bescheid, ob ICON noch dazu soll oder ob wir bei ECMWF + GFS bleiben.