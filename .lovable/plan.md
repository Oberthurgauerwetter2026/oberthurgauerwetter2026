## Status

- ✅ Baustein 1 — `refineDayFromHour` für Tag 1 nur bei `useEvening` (Zurich-Stunde ≥ 12). Sonst `fromHour=0`, keine künstliche Vornacht-Lücke.
- ✅ Baustein 2 — Tier-Fallback in `refineDayFromHour`: wenn Stundenfenster <2 Modelle liefert, fehlende Modelle aus `day.<var>.by_model` (formatDayData mit Tier-Mix) auffüllen, bevor `aggregate`/`weightedCloudSunAvg` läuft.
- ⏳ Baustein 3 — `tag0_weight_*` / `tag1_weight_*` Settings: aktivieren oder entfernen? **Wartet auf User-Entscheidung.**
- ✅ Baustein 4 — `precip_distribution` / `hourly_profile` / `cloud_sun_distribution` / `cloud_layers` jetzt bis Tag 5 (vorher Cutoff bei Tag 4).
- ✅ Baustein 5 — `models_used` und `refined_window` werden in `refineDayFromHour` nach dem Mix neu gesetzt — Diagnose lügt nicht mehr für Tag 1.
- ✅ Baustein 6 — Gemeinsamer Helper `makeCollectArrs(weather)` ersetzt vier nahezu identische Closures (in `computePrecipDistribution`, `buildHourlyProfile`, `refineDayFromHour`, `formatEveningNight`).

## Verifikation
- Typecheck grün.
- Nach nächster Generierung pro Tag in `weather_data` prüfen:
  - `models_used` ist nicht leer und enthält ICON-Modelle (auch für Tag 1).
  - Tag 5 hat `precip_distribution`, `hourly_profile`, `cloud_sun_distribution`.
  - Tag 1: bei `currentZurichHour() < 12` → `refined_window.from_hour = 0`; sonst `= 6`.
  - `precip.by_model` enthält nur echte Modell-IDs (kein `probability_*`, `low_*`, …).
