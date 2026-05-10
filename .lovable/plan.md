# Tag 2 – Tagesverlauf von Bewölkung und Niederschlag berücksichtigen

## Befund

`weather.hourly` enthält Stundendaten der CH-Modelle (ICON-CH2 reicht ~5 Tage), wäre also für Tag 2 vorhanden. **Aber:** in `formatDayData` (Z. 1884–1885) sind `precip_distribution` und `hourly_profile` hart auf `dayIndex <= 1` begrenzt. Für Tag 2 ist beides `null` → die KI hat keinerlei Tagesgang-Information und produziert eine pauschale „stark bewölkt mit Schauern"-Aussage über 24 h.

## Änderungen

### 1. `src/server/forecast.functions.ts` – Stundenprofil bis Tag 4 freischalten
- Zeile 1884: `precip_distribution: dayIndex <= 1 ? …` → `dayIndex <= 4 ? …`
- Zeile 1885: `hourly_profile: dayIndex <= 1 ? …` → `dayIndex <= 4 ? …`
- Zeile 1890: `humidity` analog auf `dayIndex <= 4` erweitern.

(ICON-CH2 hourly reicht ~120 h. Ab Tag 5 keine sinnvolle Auflösung mehr → bleibt `null`.)

### 2. `src/server/forecast.functions.ts` – `classifySky` um Tagesgang-Logik ergänzen
Neuer Schritt **vor** Regel 2 (Schauer-dominant): wenn `precip_distribution.blocks` vorliegt, prüfe Verteilung über die 4 Blöcke (night / morning / afternoon / evening).

- **Frühabbruch der Niederschläge** (morning hat ≥ 60 % der Tagessumme, afternoon + evening je < 1 mm, sun ≥ 5 h):
  → `sky_label`: „Anfangs Regen oder Schauer, später trocken und freundlicher"
  → `sky_pattern`: `frueh_regen_dann_sonne`
- **Niederschlag erst spät** (evening ≥ 60 %, morning + afternoon trocken):
  → `sky_label`: „Tagsüber meist trocken, gegen Abend Regen oder Schauer"
  → `sky_pattern`: `spaet_regen`
- **Mittagsschauer / Konvektiv** (afternoon dominant, morning + evening klar, sun ≥ 6 h):
  → `sky_label`: „Vormittags freundlich, am Nachmittag einzelne Schauer"
  → `sky_pattern`: `nachmittag_konvektiv`
- Sonst: bestehende Regel 2 / 3 / 4 wie bisher.

### 3. `DEFAULT_SKY_RULES` erweitern
Neue `sky_pattern`-Werte ergänzen (`frueh_regen_dann_sonne`, `spaet_regen`, `nachmittag_konvektiv`) mit Pflichtformulierungen, sodass die KI den Tagesgang explizit benennt.

Zusätzliche Regel: **Wenn `precip_distribution` gesetzt ist, MUSS der Wetterverlauf-Absatz die zeitliche Verteilung benennen** (z. B. „am Vormittag … nachmittags …"). Pauschalaussagen über 24 h sind verboten.

### 4. Bestehende Regel 2 unverändert lassen
Die Schauer-dominant-Regel bleibt für Tage mit gleichmässig verteiltem Niederschlag (alle 4 Blöcke nass) bestehen.

## Erwartetes Ergebnis Tag 2 (12.05.)
Die Daten von ICON-CH2 zeigen voraussichtlich Niederschlag-Schwerpunkt im Vormittag (Frontdurchgang Westwind 270°). Mit dem neuen Code ergibt sich z. B.:
- `sky_label` → „Anfangs Regen oder Schauer, später trocken und freundlicher"
- KI-Text → „Anfangs noch etwas Regen oder einzelne Schauer, danach Auflockerung mit zunehmend sonnigen Phasen am Nachmittag."

## Geänderte Dateien
- `src/server/forecast.functions.ts`

Anschliessend Forecast für 12.05. neu generieren.
