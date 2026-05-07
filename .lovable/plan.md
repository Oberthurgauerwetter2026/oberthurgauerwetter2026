## Problem

Im aktuellen Forecast (letzter Tag = Tag 5) fehlt `meteoswiss_icon_ch2` in `by_model`. Ursache: In `pickBestSource()` und `collectModelValuesTiered()` (`src/server/forecast.functions.ts` ~Z. 846 / 858) ist die Tier-Grenze auf `dayIndex <= 4` gesetzt. Tag 5 fällt damit in den **long-Tier** (`ecmwf_ifs025, gfs_global`) — und ICON-CH2 ist dort gar nicht abgefragt.

ICON-CH2 hat aber eine Reichweite von ~5 Tagen und ist im mid-Tier-Set enthalten — die Daten wären verfügbar, sie werden für Tag 5 nur nicht ausgewertet.

## Lösung

Tier-Grenze für Tag 5 auf **mid** verschieben.

### Änderung in `src/server/forecast.functions.ts`

**`pickBestSource()` (Z. 846–852):**
```
if (dayIndex <= 1) → short
if (dayIndex <= 5) → mid     // statt <= 4
sonst              → long
```

**`collectModelValuesTiered()` (Z. 858–870):**
Gleiche Anpassung — `dayIndex <= 5` benutzt mid als primären Tier (mit short/long als Fallback). Für `dayIndex > 5` bleibt long primär.

Da der mittelfristige Modell-Lauf ohnehin ICON-CH2, ICON-D2, IFS, ARPEGE und GFS (mit Gewicht 0.5) enthält, bekommt Tag 5 dadurch automatisch ICON-CH2 + ICON-D2 zusätzlich zu IFS/GFS — ohne Mehraufwand bei Open-Meteo (mid-Daten sind bereits gefetched).

### Optional: ICON-CH2-Reichweite absichern

Falls Open-Meteo für Tag 5 in `meteoswiss_icon_ch2_*`-Spalten `null` liefert (jenseits Modell-Horizont), wird das Modell in `collectModelValues()` ohnehin still übersprungen — kein Risiko für leere Mittelwerte, weil ICON-D2/IFS/ARPEGE/GFS weiter beitragen.

## Validierung

Nach Implementierung:
- Tag 5 (`weather_data.cloudcover.by_model` etc.) enthält `meteoswiss_icon_ch2` (und `icon_d2`).
- Tag 0/1 unverändert (short).
- Tag 6–10 (Trend) unverändert (long).

## Keine weiteren Änderungen

- Kein DB-Migration nötig.
- Keine UI-Änderung.
- Modell-Gewichtung (GFS = 0.5) bleibt wie aktuell.
