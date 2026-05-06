# Abend/Nacht-Niederschlag: stundenscharfe Veredelung statt Tagesfaktor

## Problem mit der aktuellen Lösung

Der Faktor `veredelter_tag0 / roher_OM_tag0` schiesst hoch, wenn Radar/Bias den Tageswert wegen **bereits gefallenem** Niederschlag erhöht haben. Der Faktor wird dann fälschlich auf das **Restfenster** angewendet (3.0× Cap → 45 mm wird zu 136 mm, obwohl die nächsten Stunden trocken sind).

## Neue Logik: stundenweise mit besten verfügbaren Quellen

Im Restfenster (jetzt → 05:00 Folgetag) wird **stundenweise** ein Wert gewählt – beste verfügbare Quelle gewinnt:

```text
Stunde t:
  if t in [now, now+2h] und Radar verfügbar:
      mm = radar.forecast_next_2h[t]            // ICON-CH1 radar-assimiliert
      source = "radar"
  elif t in [now+2h, now+6h] und Radar verfügbar:
      mm = radar.forecast_hours[t]              // ICON-CH1 (Open-Meteo)
      source = "icon_ch1_radar"
  else:
      mm = mean(ICON-CH1, ICON-CH2, AROME, ICON-D2 stündlich)
      source = "om_hourly_short_tier"
```

`precip_total = Summe der Stundenwerte`. Kein globaler Faktor mehr, kein Cap.

## Was getan wird

### `src/server/forecast.functions.ts`

1. `formatEveningNight(weather, startHourOverride, radarSnapshot?)` erweitern:
   - Neuer optionaler Parameter `radarSnapshot`.
   - Stundenweise Berechnung wie oben. Index der Stunde = `slice[i].t` mit Radar-Hours abgleichen (gleiche ISO-Strings).
   - `precip_sources_by_hour: [{time, mm, source}]` ablegen für UI/Debug.
   - `precip_total` neu = Summe daraus (nicht mehr nur OM-hourly).
   - `precip_total_raw_om` weiter beilegen (zum Vergleich).

2. `buildFirstEntryContext`:
   - Tagesfaktor-Skalierung **entfernen**.
   - `radarSnapshot` einfach an `formatEveningNight` durchreichen.
   - `precip_scale_factor` und das `radar_next_2h_floor`-Konstrukt entfallen.
   - `precip_sources` wird zur deduplizierten Liste der genutzten Stunden-Quellen.

3. Tier-Filter (GFS/IFS-Blocklist) bleibt für die Fallback-Stunden.

### `src/components/WeatherDataView.tsx`

- Bestehender Block für „Restfenster" zeigt jetzt:
  - Summe `precip_total`
  - Quellen-Aufschlüsselung (z. B. „2h Radar: 3.3 mm · 4h ICON-CH1: 1.2 mm · 6h Modellmittel: 0.0 mm")
- `precip_scale_factor` / `tag0_refined_precip_mm` entfernen.

## Erwartetes Verhalten

- Wenn aktuell Radar Niederschlag zeigt → erste Stunden realistisch, ohne dass die Tagessumme „nach oben hochgezogen" wird.
- Wenn aktuell trocken aber Modelle für Abend Niederschlag sehen → Modellmittel greift wie gewohnt.
- Keine Skalierungs-Artefakte (kein 3.0× mehr).
- Tag-0-Tagesdatensatz selbst ist nicht betroffen – nur der Restfenster-Eintrag.

## Geänderte Dateien

- `src/server/forecast.functions.ts` (formatEveningNight, buildFirstEntryContext)
- `src/components/WeatherDataView.tsx` (Anzeige Quellen statt Skalierungsfaktor)
