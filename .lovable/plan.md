## Variante C — Tag 0 mit gewichtetem Mix statt MOSMIX-Hard-Override

### Ziel
Tag 0 soll nicht mehr 100 % MOSMIX sein. Stattdessen ein gewichteter Mix aus MOSMIX, Open-Meteo Multi-Modell und Nowcast/Radar — über **alle Parameter** (Temperatur, Niederschlag, Wind, Bewölkung). Stations-Bias wird ebenfalls aktiviert. Nowcast/Radar bleiben als Korrektur on top.

### Aktueller Zustand (Tag 0)
- MOSMIX überschreibt komplett `tmin`, `tmax`, `precip`, `wind_max`, `cloudcover` (Hard-Override).
- Open-Meteo nur als `om_reference` mitgespeichert, ungenutzt.
- Stations-Bias deaktiviert (`if (!mosmix)` in Z. 1454/1639).
- Nowcast wirkt nur in den engen Grenzen aus `nowcast.server.ts` (Bewölkungs-Diff ≥25 %, Radar-Faktor 0.4–2.5, Wind-Faktor 0.6–1.6, Nacht-Auskühlung).
- Radar überschreibt `precip.avg` direkt, sofern `radar_correction.applied`.

### Neue Logik (Tag 0)

**1. Gewichteter Basis-Mix (statt Override)**

In `buildDay` (beide Stellen ~Z. 1428 und ~Z. 1613) für `dayIndex === 0`:

```text
om     = Open-Meteo Multi-Modell-Tag (omDay)
mos    = MOSMIX-Tag (mosmixDay) — kann null sein
gewichte (default, in app_settings konfigurierbar):
  w_mosmix = 0.40
  w_om     = 0.60
mix(field) = w_mosmix * mos[field] + w_om * om[field]   wenn beide vorhanden
           = mos[field]  wenn nur MOSMIX
           = om[field]   wenn nur OM
```

Felder die so gemischt werden: `tmin.avg`, `tmax.avg`, `precip.avg`, `wind_max.avg`, `cloudcover.avg`. `min/max/spread/by_model` bleiben aus dem Open-Meteo-Objekt erhalten (für die Modell-Tabelle in der UI).

`weathercode` und `precip_prob` weiterhin aus Open-Meteo (MOSMIX hat das nicht zuverlässig).

`mosmix_reference` wird zusätzlich angehängt (analog Tag 1), damit MOSMIX im Datenpanel sichtbar bleibt. `om_reference` entfällt für Tag 0, da OM jetzt im Mix steckt.

**2. Stations-Bias auch für Tag 0 anwenden**

`applyStationBias` wird unabhängig vom MOSMIX-Status aufgerufen. Begründung: der Mix enthält jetzt zu 60 % Open-Meteo-Rohdaten, die Bias-Korrektur sinnvoll machen.

**3. Nowcast/Radar mit voller Wirkung auf alle Parameter**

Aktuell wirkt der Nowcast bereits auf `tmin`, `tmax`, `wind_max`, `cloudcover`, `precip` — das passt. Folgende Verstärkungen:

- `applyNowcastToDay` Z. 247: die Bedingung `out.cloudcover_source === "model"` entfernen, damit die Korrektur unabhängig von der Quelle greift (Mix-Quelle ist jetzt `mix`, nicht `model`).
- Radar-Korrektur in `applyRadarToDay` Z. 30 darf jetzt sowohl nach oben als auch nach unten korrigieren (heute: ersetzt `precip.avg`, prob nur nach oben). Bleibt so, da `buildRadarCorrection` bereits beide Richtungen kann.
- Zusätzlich: wenn Nowcast einen Wind-Faktor liefert, soll dieser auch auf `wind.avg` (nicht nur `wind_max`) wirken, falls vorhanden.
- Nowcast-Wirkungsfenster: Nowcast/Radar gilt explizit für Tag 0 (so wie heute). Die ersten ~6 h Radar-Forecast und ~3 h SMN-Beobachtungen bestimmen die Korrektur. Verlängerung des Beobachtungsfensters auf bis zu 12 h via `nowcast_obs_horizon_h` (existiert bereits).

**4. Konfigurierbare Gewichte**

Neue Spalten in `app_settings`:
- `tag0_weight_mosmix` numeric default 40 (Prozent)
- `tag0_weight_om` numeric default 60 (Prozent)
- (Summe wird im Code normalisiert)

Im Settings-UI (falls vorhanden — sonst nur DB-Default) zwei Slider 0–100.

**5. System-Prompt anpassen**

Im `buildSystemPrompt`-Block ergänzen, dass für Tag 0 die Werte ein gewichteter Mix sind und MOSMIX-Referenz als Plausibilitätscheck dient (analog zur Tag-1-Regel).

### Erwartetes Verhalten

- Heute (Tag 0): Wenn ICON-CH1/CH2 deutlich anders sehen als MOSMIX, schlägt das jetzt mit 60 % auf die Tageswerte durch — z. B. höhere Niederschlagssumme, andere tmax.
- Stations-Bias greift: GUT/STG/TAE-Korrekturen wirken auch auf den heutigen Tag.
- Nowcast korrigiert weiterhin Klarnacht-Auskühlung, Bewölkungsdiff, Wind-Faktor und Niederschlag — jetzt aber auf einen Mix-Basis-Wert, nicht auf MOSMIX-Wert.
- Radar (0–6 h) hebt/senkt die Tagessumme bei klarer Diskrepanz weiterhin.
- MOSMIX bleibt im UI als `mosmix_reference` sichtbar.

### Geänderte Dateien

- `src/server/forecast.functions.ts` — buildDay-Logik (beide Stellen), Stations-Bias-Aufruf, Prompt
- `src/server/nowcast.server.ts` — `applyNowcastToDay` Bewölkungs-Bedingung lockern
- `src/components/WeatherDataView.tsx` — Anzeige des Mix-Verhältnisses, MOSMIX als Referenz auch für Tag 0
- DB-Migration — zwei neue Spalten in `app_settings`
- ggf. `src/routes/_app.settings.tsx` — Slider für die zwei Gewichte

### Offene Frage

Aktuelle Default-Gewichte: **40 % MOSMIX / 60 % Open-Meteo** für Tag 0. OK so, oder lieber 50/50, oder 30/70?
