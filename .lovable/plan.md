# AROME zurück + Wind-Feintuning

## 1. AROME wieder in die Modell-Tiers aufnehmen

Open-Meteo-IDs:
- `meteofrance_arome_france_hd` — 1.3 km, ~36 h Reichweite (sehr gut für T)
- `meteofrance_arome_france` — 2.5 km, ~48 h

**`app_settings`-Defaults aktualisieren** (DB-Migration, einmalig) und parallel die Hardcoded-Defaults in `src/routes/_app.settings.tsx` (Zeilen 41–43, 80–82, Placeholder 251/255) anpassen:

```
models_shortterm: meteoswiss_icon_ch1, meteoswiss_icon_ch2, meteofrance_arome_france_hd, meteofrance_arome_france
models_midterm:   meteoswiss_icon_ch2, meteofrance_arome_france, ecmwf_ifs025, gfs_global
models_longterm:  ecmwf_ifs025, gfs_global, icon_eu     (unverändert — AROME reicht nicht so weit)
```

Damit fliesst AROME automatisch in Temperaturmittel (Tag 0–2) ein. Code-seitig sind keine weiteren Änderungen nötig — `collectModelValuesTiered` zieht die Modelle aus den Settings.

## 2. Wind-Nachbesserung in `src/lib/forecast.functions.ts`

**A. `WIND_WEIGHTS` neu balancieren** (Zeilen 118–124):
```
meteoswiss_icon_ch1:          0.40   (war 0.55 — zu dominant solo)
meteoswiss_icon_ch2:          0.30   (war 0.45)
meteofrance_arome_france_hd:  0.25   (NEU — sehr gut bei Bise/Föhn am Bodensee)
meteofrance_arome_france:     0.15   (NEU)
ecmwf_ifs025:                 0.20
icon_eu:                      0.10   (war 0.15)
gfs_global:                   0.05   (war 0.10)
```
Wirkung: bei Verfügbarkeit dominiert weiterhin ICON-CH, AROME bringt frühen Tagen eine zweite hochauflösende Stimme; globale Modelle wirken nur noch dann stark, wenn die HD-Modelle weg sind (Tag 6+).

**B. Windrichtung folgt automatisch** — `weightedCircularMeanDeg` nutzt dasselbe `WIND_WEIGHTS`-Objekt.

**C. Wind-Bias-Korrektur belassen** — `bias-correction.server.ts` (factor_wind, clamped 0.5–1.8) bleibt unverändert; sie korrigiert systematische Über-/Unterschätzung gegenüber SMN BIZ/GUT auf Basis der neuen Mischung weiter.

## Bewusst NICHT im Plan
- ICON-D2 reaktivieren — wurde früher entfernt; AROME deckt die HD-Lücke besser ab.
- R2-Ingest-Skript (`scripts/ingest_openmeteo.py`) anpassen — Forecasts laufen über Direkt-Fetch, nicht über den R2-Cache.
- MOSMIX-Gewichte ändern.

## Verifikation
Nach Implementation eine neue Prognose generieren und `weather_data` eines Tag-1- und Tag-3-Eintrags prüfen:
- `tmax.values_by_model` enthält `meteofrance_arome_france_hd` (Tag 0/1) bzw. `meteofrance_arome_france` (Tag 2).
- `wind_max.weights_used` zeigt 3–4 Modelle mit AROME-Anteil; Bisen-/Föhnlagen sollten realistischer wirken.

## Offene Frage (optional, vor Umsetzung)
Falls du beim Wind ein konkretes Symptom hast (z. B. „systematisch zu schwach" oder „Richtung dreht zu südlich"), sag's kurz — dann kann ich die Bias-Klammer oder die Gewichte gezielter setzen statt nur über die Tier-Mischung.
