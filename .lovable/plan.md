# Prognosequalität verbessern: Niederschlags-Tagesgang & Bewölkung

Ziel: präziseres Timing von Regen und realistischere Bewölkungs-/Sonnen­beschreibung über alle Tage (0–6). Drei Ebenen parallel: Datenpipeline, Prompt, Validierung/Diagnostik.

## 1. Datenpipeline

### 1a. Feinere Tagesblöcke statt 4×6h-Raster
Aktuell teilt `computePrecipDistribution` den Tag in 4 starre 6h-Blöcke. Ein Regenende um 09:00 fällt komplett in „morning (06–12)" und macht den ganzen Vormittag „nass". Umstellen auf 6 feinere Blöcke:

```
night       00–06
early_morn  06–09
late_morn   09–12
afternoon   12–17
late_aft    17–20
evening     20–24
```

`peak_block` und Block-Liste werden auf dieses Raster gemappt. Der Prompt erhält ein zusätzliches `narrative` Feld mit kompakter Klartext-Story (siehe 1d).

### 1b. Wetterbesserung/-verschlechterung als strukturierte Felder berechnen
Statt nur per Prompt-Regel: in `computePrecipDistribution` ein neues Feld `trend` ergänzen, server-seitig berechnet aus dem Stundenverlauf:
- `improving` – Niederschlag konzentriert in der ersten Tageshälfte, Nachmittag/Abend < 0.5 mm/h und ≥ 4h trocken
- `deteriorating` – umgekehrt
- `intermittent` – mehrere getrennte Niederschlagsphasen mit ≥ 3h Pause
- `steady` – ganztägig ähnlich verteilt
- `dry` – Tagessumme < 1 mm

Mit `transition_hour` (Stunde des Wechsels nass↔trocken) und `dry_after_hour` / `wet_after_hour`.

### 1c. Bewölkungs-Tagesgang strukturiert ableiten
Analog zu `precip_distribution` einen neuen Block `cloud_distribution` einführen (Tag 0–4), aus stündlichem `cloudcover` + `sunshine_duration`:
- pro Block: `cloud_pct`, `sunshine_min`, `category` (klar | heiter | wolkig | bedeckt)
- `pattern`: `clear_all_day` | `morning_clouds_clearing` | `afternoon_buildup` (Quellbewölkung) | `evening_clearing` | `overcast_all_day` | `variable`
- `pattern_confidence` aus Modellstreuung

`detectFogDissipation` bleibt; `sky_pattern` wird auf Tag 0–4 ausgeweitet (analog zur Niederschlags-Erweiterung).

### 1d. Server-seitige Klartext-Story (Anker für die KI)
Pro Tag ein Feld `day_narrative` (3–5 kurze Sätze, deterministisch, kein KI-Aufruf), das die Story aus `precip_distribution.trend`, `cloud_distribution.pattern`, `fog_dissipation`, `wind_gusts.peak_hour`, `thunderstorm.peak_hour` zusammensetzt. Die KI wird im Prompt verpflichtet, dieser Story chronologisch zu folgen (sie darf sie sprachlich ausschmücken, aber Reihenfolge und Zeitbezüge nicht verändern).

### 1e. Modellauswahl überprüfen
- `weatherForHourly` so härten, dass bei lückenhaften Short-Tier-Daten (z. B. ICON-CH1 abgelaufen) automatisch auf Mid-Tier zurückgegriffen wird – nicht nur bei komplett leerem `hourly` (heutige Schwelle), sondern auch wenn < 18 von 24 Stunden vorhanden sind.
- Beim Median-Mix in `computePrecipDistribution`: Modelle mit > 3× Abweichung vom Median als Ausreißer markieren und ihr Gewicht halbieren statt sie ungewichtet zu mitteln (häufiger Fehler: GFS-Global „verschmiert" Regen über zu viele Stunden).
- `precipitation_probability` getrennt führen pro Modell und in den Prompt mit einbeziehen, statt nur Maximum.

## 2. Prompt-Engineering

### 2a. Regelblock NIEDERSCHLAGS-TAGESGANG vereinfachen
Aktuell sehr lang und mit Überschneidungen. Neu:
1. `precip_distribution.day_narrative` ist verbindlich – chronologisch übernehmen.
2. `trend` bestimmt das Schlüsselwort: `improving` → "Wetterbesserung im Tagesverlauf", `deteriorating` → "Wetterverschlechterung", `intermittent` → "wiederholt Schauer", `dry` → "weitgehend trocken".
3. Blöcke ohne Niederschlag dürfen/sollen explizit als trocken benannt werden, wenn sie zur Story gehören.
4. Verbot wie bisher: keine Tageszeit erfinden, die nicht in der Verteilung steht.

### 2b. Regelblock BEWÖLKUNG/SONNE
Auf `cloud_distribution.pattern` aufbauen, statt nur auf Tagesmittel `sunshine_h`. Klare Mapping-Tabelle:
- `morning_clouds_clearing` → "am Morgen stark bewölkt, im Tagesverlauf Auflockerungen / sonnig"
- `afternoon_buildup` → "am Vormittag sonnig, am Nachmittag Quellwolken / einzelne Schauer"
- `evening_clearing` → "tagsüber wechselnd bewölkt, gegen Abend Aufhellungen"
- `overcast_all_day` → "ganztägig stark bewölkt / bedeckt"

`sunshine_h.avg` bleibt sekundärer Anker für die Intensität ("ziemlich sonnig" vs. "nur kurz").

### 2c. Konsistenz Daten ↔ Text
Neuer Pflichtsatz: Wenn `cloud_distribution.pattern` und `precip_distribution.trend` vorhanden sind, MUSS der erste Satz des Tagesabsatzes diese Story widerspiegeln (nicht nur die Tagesmittelwerte).

## 3. Validierung & Diagnostik

### 3a. Server-seitiger Konsistenz-Check (logging)
Nach `formatDayData`: prüfen und `console.warn` wenn
- `precip.avg ≥ 1` aber `precip_distribution === null`
- `precip_distribution.trend === 'improving'` aber `cloud_distribution.pattern === 'overcast_all_day'`
- `sunshine_h.avg ≥ 9` aber `cloudcover.avg ≥ 70`

### 3b. Optional: Post-Generation-Check (Tag 0–4)
Nach AI-Antwort einfache Heuristik (Regex/Wortlisten) gegen Datenfelder prüfen:
- enthält der Text "am Morgen Regen" obwohl `morning.precip_mm < 0.5`? → Warnung im Admin-UI
- erwähnt der Text Wetterbesserung obwohl `trend !== 'improving'`?

Resultat als sichtbares „Plausibilitäts-Badge" pro Eintrag im Forecast-Editor (rot/gelb/grün) – ohne automatische Korrektur, aber als Qualitäts-Signal für den Redakteur.

### 3c. Cache-Schlüssel anpassen
Da sich Datenform ändert (`day_narrative`, neue Blöcke, `cloud_distribution`), Cache-Key-Suffix erhöhen, damit alte Einträge im weather_cache nicht mehr getroffen werden.

## Technische Details

**Geänderte Dateien**
- `src/server/forecast.functions.ts`
  - `computePrecipDistribution`: 6-Block-Raster, `trend`, `transition_hour`, `day_narrative`-Bausteine
  - neue Funktion `computeCloudDistribution`
  - neue Funktion `buildDayNarrative`
  - `formatDayData`: `cloud_distribution`, `day_narrative`, Konsistenz-Logging, `sky_pattern` auf Tag 0–4 ausweiten
  - `weatherForHourly`: Mid-Tier-Fallback bei Lückenhaftigkeit, nicht nur bei totalem Fehlen
  - `buildSystemPrompt`: Regelblöcke NIEDERSCHLAG und BEWÖLKUNG ersetzen, neuer Pflichtsatz Konsistenz
  - `fetchWeather` Cache-Key-Suffix
- `src/server/ensemble.server.ts` ggf. unverändert
- Forecast-Editor (Frontend) für 3b: kleines Badge-Component (optional, falls 3b umgesetzt wird)

**Reihenfolge der Umsetzung**
1. Datenfelder (1a, 1b, 1c, 1d) implementieren – ohne Prompt-Änderung – und einen Tag generieren, um die berechneten Felder zu prüfen.
2. Cache-Key erhöhen.
3. Prompt-Regeln umstellen (2a, 2b, 2c).
4. Diagnostik (3a) – billig, sofort.
5. Modellauswahl-Härtung (1e).
6. Optional Plausibilitäts-Badge (3b).
