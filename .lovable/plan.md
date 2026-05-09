## MOSMIX-Einsatz verschieben: Tag 0/1 raus, Tag 2 moderat, ab Tag 3 stärker

Aktuell mischt `mixOmWithMosmix()` MOSMIX bereits in Tag 0 (40 %) und Tag 1 (50 %). Du willst MOSMIX dort komplett rausnehmen und stattdessen erst ab Tag 2 (24–48 h) moderat und ab Tag 3 (>48 h) deutlicher einsetzen — passt zu DWD MOSMIX_L, das bis ~10 Tage reicht und in der Mittelfrist seine MOS-Stärke (statistische Korrektur stationsspezifisch) besser ausspielt als Tag 0, wo Radar/Nowcast/Stations-Bias bereits dominieren.

### Neue Gewichte (Default)

| Tag | MOSMIX | Open-Meteo Mix | Bemerkung |
|---|---|---|---|
| Tag 0 (0–24 h) | **0 %** | 100 % | Radar, SMN-Bias, ICON-CH1/CH2, ARPEGE übernehmen |
| Tag 1 (12–36 h) | **0 %** | 100 % | dito |
| Tag 2 (24–48 h) | **25 %** | 75 % | moderate Stützung |
| Tag 3+ (>48 h) | **45 %** | 55 % | deutlicher MOSMIX-Anteil |

### Änderungen

1. **DB-Migration** (`app_settings`):
   - Neue Spalten:
     - `tag2_weight_mosmix integer NOT NULL DEFAULT 25`
     - `tag2_weight_om integer NOT NULL DEFAULT 75`
     - `tag3plus_weight_mosmix integer NOT NULL DEFAULT 45`
     - `tag3plus_weight_om integer NOT NULL DEFAULT 55`
   - Defaults für `tag0_weight_mosmix` und `tag1_weight_mosmix` auf `0` setzen (Spalten bleiben für Rückwärtskompatibilität, werden aber nicht mehr ausgewertet).
   - Bestehenden Eintrag updaten: `tag0_weight_mosmix=0`, `tag1_weight_mosmix=0`, neue Felder bekommen ihre Defaults.

2. **`src/server/forecast.functions.ts`** — `buildDay`-Logik in beiden Vorkommen (Zeilen ~2382 und ~2570):
   ```ts
   const tag2WM = settings?.tag2_weight_mosmix ?? 25;
   const tag2WO = settings?.tag2_weight_om ?? 75;
   const tag3WM = settings?.tag3plus_weight_mosmix ?? 45;
   const tag3WO = settings?.tag3plus_weight_om ?? 55;
   // ...
   if (dayIndex === 2 && mosmixDay) base = mixOmWithMosmix(omDay, mosmixDay, tag2WM, tag2WO);
   else if (dayIndex >= 3 && mosmixDay) base = mixOmWithMosmix(omDay, mosmixDay, tag3WM, tag3WO);
   // dayIndex 0/1: kein MOSMIX-Mix mehr
   ```
   Tag-0/1-Pfade werden gestrichen. Die alten Variablen `tag0WMosmix`/`tag1WMosmix` entfallen.

3. **Zod-Schema** (Z. ~2836–2839) um neue Felder erweitern (`tag2_weight_mosmix`, `tag2_weight_om`, `tag3plus_weight_mosmix`, `tag3plus_weight_om`).

4. **`src/routes/_app.settings.tsx`**:
   - Form-State: `tag2_weight_mosmix/om` und `tag3plus_weight_mosmix/om` ergänzen, Defaults wie oben.
   - Tag-0- und Tag-1-Slider ersetzen durch zwei neue Slider-Paare "Tag 2 (24–48 h)" und "Tag 3+ (>48 h)".
   - Hinweistext im Card-Header anpassen: "MOSMIX wird ab Tag 2 als statistische Stützung beigemischt; Tag 0 & 1 laufen rein über Open-Meteo + Radar + SMN-Bias."

### MOSMIX-Daten verfügbar?

`fetchMosmixShortTerm` liefert aktuell nur Tag 0/1 (siehe Funktionsname). Vor der Umstellung muss ich prüfen, ob die Funktion bereits Tag 2+ enthält oder erweitert werden muss. Falls nur Tag 0/1 zurückkommt: `fetchMosmixShortTerm` umbenennen/erweitern auf Tag 0–7 (KMZ enthält volle Reihe) und nur die Mix-Logik gezielt für Tag 2+ anwenden.

### Was bleibt unverändert

- MOSMIX-Stationen (10935 Friedrichshafen, 10929 Konstanz), Cache, KMZ-Parser.
- `mixOmWithMosmix()` selbst — nur die Aufrufe verschieben.
- Tag-0/1-Pipeline (Radar-Korrektur, SMN-Bias, Nowcast, Horizont-Gewichtung) bleibt, läuft jetzt **ohne** MOSMIX-Beimischung.

### Risiken

- Falls MOSMIX_L für Tag 3+ Lücken hat (Stationsausfall) → Fallback ist `omDay`, kein Crash.
- Tag 0/1 verlieren die statistische DWD-Korrektur. Mitigation: SMN-Bias (Bischofszell+Güttingen) und Radar-Korrektur sind aktiv und ortsnäher.
