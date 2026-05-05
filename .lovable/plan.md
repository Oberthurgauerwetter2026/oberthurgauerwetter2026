## Tag 1 Open-Meteo-getrieben + Niederschlags-Tagesgang (Variante B)

### Ziel
- Tag 1 (z. B. Mittwoch) nicht mehr durch MOSMIX überschreiben — Open-Meteo Multi-Modell + Stations-Bias führen
- MOSMIX bleibt für Tag 1 als Cross-Check sichtbar (`mosmix_reference`)
- Stündlicher Niederschlags-Tagesgang (Nacht/Vormittag/Nachmittag/Abend) für Tag 0 und Tag 1, damit der Text die richtige Tageszeit nennt

### Änderungen

**`src/server/forecast.functions.ts`**

1. `HOURLY_VARS`: `precipitation_probability` ergänzen.

2. Neuer Helper `computePrecipDistribution(weather, dayIndex)`:
   - liest `weather.hourly` (alle Modell-Suffixe), filtert auf das Datum von `dayIndex`
   - vier Blöcke: `night 00–06`, `morning 06–12`, `afternoon 12–18`, `evening 18–24` (Lokalzeit aus ISO-String, kein TZ-Konvertieren nötig — Open-Meteo-Stundenstring ist bereits Europe/Zurich)
   - pro Block: Summe `precipitation` (Mittel über Modelle pro Stunde), Max `precipitation_probability`, Anzahl Stunden mit ≥ 0.2 mm
   - `peak_block` = Block mit höchster Summe (nur wenn ≥ 1 mm), `peak_block_prob` = max prob über alle Blöcke
   - liefert `null` bei fehlenden Stundendaten

3. `formatDayData`: bei `dayIndex <= 1` `precip_distribution` ergänzen.

4. MOSMIX-Override-Schwelle in beiden buildDay-Stellen (Zeilen ~1349 und ~1524) von `dayIndex <= 1` auf `dayIndex === 0` reduzieren. Für `dayIndex === 1` MOSMIX-Daten optional als `mosmix_reference: { tmin, tmax, precip, wind_max, cloudcover_avg, per_station }` ans `omDay`-Objekt anhängen, ohne die Werte zu überschreiben.

5. System-Prompt (`buildSystemPrompt`) um neuen Block ergänzen:
   ```
   === NIEDERSCHLAGS-TAGESGANG ===
   Wenn `precip_distribution` vorhanden ist mit `peak_block`:
   - "morning" → "am Vormittag", "afternoon" → "am Nachmittag", "evening" → "am Abend", "night" → "in der Nacht"
   - Hauptniederschlag in diesem Block nennen, andere Blöcke nur erwähnen wenn ≥ 1 mm
   - Wenn ein Block 0 mm hat, ihn explizit als trocken/niederschlagsfrei beschreiben können
   - peak_block_prob ≥ 70 % → bestimmt formulieren ("Regen"); 40-69 % → "zeitweise Schauer"; < 40 % → "vereinzelt Schauer möglich"
   Wenn `precip_distribution` fehlt: weiter wie bisher.
   Wenn `mosmix_reference` vorhanden: nur als interne Plausibilitätskontrolle nutzen, NICHT im Text erwähnen.
   ```

**`src/components/WeatherDataView.tsx`**

Zusätzlicher kleiner Block unter der Modell-Tabelle, falls `data.precip_distribution` vorhanden:
- 4 Spalten (Nacht / Vormittag / Nachmittag / Abend) mit mm + max %, Spitzenblock hervorgehoben
- Falls `data.mosmix_reference` vorhanden: kleine Zeile „MOSMIX (Referenz, nicht verwendet): tmin/tmax/precip/wind_max"

### Erwartetes Verhalten Mittwoch
- ICON-CH1 (100 %) und ICON-D2 (Wettercode 95) bekommen vollen Einfluss auf Tagessumme
- Stations-Bias greift (-0.5 °C tmax / +1.4 °C tmin von GUT u. a.)
- Tagesgang zeigt z. B. „peak_block: afternoon, prob 95 %" → Text nennt „am Nachmittag Hauptniederschlag, teils mit Gewittern, am Vormittag noch trocken bis vereinzelt Schauer"
- MOSMIX bleibt sichtbar im Datenpanel zur Kontrolle

### Geänderte Dateien
- `src/server/forecast.functions.ts`
- `src/components/WeatherDataView.tsx`
