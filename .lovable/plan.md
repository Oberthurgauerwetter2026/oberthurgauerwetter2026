# Wind-Beurteilung: Befund & Plan

## Befund — wo der Wind aktuell „lückenhaft" wird

Keine Datenquelle fehlt komplett, aber durch die letzte Modell-Bereinigung gibt es **Qualitätslücken ab Tag 2**:

**Aktuelle Modell-Tiers (DB):**
- Short: `meteoswiss_icon_ch1, meteoswiss_icon_ch2` (1-2 km)
- Mid:   `meteoswiss_icon_ch2, ecmwf_ifs025, gfs_global` (25 km global)
- Long:  `ecmwf_ifs025, gfs_global, icon_eu`

**1. Tier-Mixing-Schwelle frisst die ICON-CH-Daten weg**
`collectModelValuesTiered` (src/lib/forecast.functions.ts:1594) zieht für Tag 2-5 zuerst Mid (3 Modelle) — und bricht ab, weil schon `≥2` Modelle vorhanden sind. ICON-CH1 aus dem Short-Tier wird **nicht** beigemischt. Ab Tag 6 fehlen ICON-CH-Daten komplett.

**2. `WIND_WEIGHTS` kennt nur ICON-CH1/CH2**
(forecast.functions.ts:118-121). Folgen:
- Tag 2-5: nur ICON-CH2 hat ein Gewicht → "weighted avg" = ICON-CH2 allein, ECMWF/GFS fallen weg.
- Tag 6+: kein einziges WIND_WEIGHTS-Modell vorhanden → `weightedWindAvg` liefert `null` → Fallback auf rohen Mittelwert globaler Modelle. Richtung/Stärke werden grob, „Bise" wird oft verfehlt.

**3. Bias-Korrektur greift, ist aber gedeckelt**
SMN-Stationen BIZ/GUT korrigieren Wind multiplikativ (clamped). Hilft bei moderater Über-/Unterschätzung, nicht bei systematisch falscher Richtung.

## Plan — drei chirurgische Fixes in `src/lib/forecast.functions.ts`

### A. ICON-CH-Wind immer beimischen (Tag 2-5)
In `collectModelValuesTiered` für die Wind-Variablen (`windspeed_10m_max`, `wind_gusts_10m_max`, `winddirection_10m_dominant`) die `≥2`-Abbruchregel überspringen und immer auch den Short-Tier dazumischen, solange dort Werte existieren. Andere Variablen bleiben unverändert.

### B. `WIND_WEIGHTS` um globale Modelle erweitern
```
meteoswiss_icon_ch1: 0.55
meteoswiss_icon_ch2: 0.45
ecmwf_ifs025:       0.20
gfs_global:         0.10
icon_eu:            0.15
```
Damit liefert `weightedWindAvg` auch für Tag 6+ einen sinnvoll gewichteten Wert statt eines naiven Mittels. ICON-CH dominiert, wo vorhanden; sonst übernimmt ECMWF die Führung.

### C. Richtung zieht automatisch mit
`weightedCircularMeanDeg` nutzt dasselbe `WIND_WEIGHTS`-Objekt — Änderung B repariert die Windrichtung mit, ohne zusätzlichen Code.

## Bewusst NICHT im Plan

- ICON-D2 / AROME wieder einführen — wurde von dir explizit entfernt.
- R2-Ingest-Skript anpassen — Forecasts laufen direkt über `fetchOpenMeteo`, nicht über den R2-Cache.
- MOSMIX-Gewichte ändern — Ensemble-Blending ist orthogonal und funktioniert.

## Verifikation nach dem Fix

Eine Prognose komplett neu generieren und `weather_data` eines Tag-3-Eintrags prüfen: `wind_max.weights_used` sollte mehrere Modelle zeigen, `wind_dir_compass` plausibler zur Wetterlage passen.
