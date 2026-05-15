## Plan — Bausteine C & D: Ausreisser dämpfen + AI-Prompt auf Datenqualität konditionieren

Nach Baustein B (AROME-HD trägt jetzt zu Bewölkung Samstag bei) bleiben zwei strukturelle Schwächen offen, die zu „recht sonnig"-Aussagen auf dünner Datenbasis führen können.

### Baustein C — Ausreisser-Trimming bei Sonne und Bewölkung

Problem: ICON-D2 wich Samstag bei Sonnenscheindauer um 7.7 h von ICON-CH1 ab (8.6 h vs. 0.9 h). Der gewichtete Mittelwert (4.3 h) lag näher an D2 als am CH-Konsens.

Umsetzung in `src/server/forecast.functions.ts`:
- Neue Helper-Funktion `trimmedConsensus(values, weights, options)`:
  - berechnet Median und Median-Absolute-Deviation (MAD) der Modellwerte
  - wenn `spread (max-min) > schwelle` (Sonne: 4 h, Bewölkung: 40 %): Modelle, die mehr als 1.5×MAD vom Median abweichen, bekommen Gewicht ×0.3
  - normalisiert Gewichte neu und liefert gewichtetes Mittel zurück
- Anwendung nur für `sunshine_h` und `cloudcover` (Niederschlag/Wind unverändert — dort ist Spread aussagekräftig).
- Im `by_model`-Objekt zusätzlich `trimmed: true` und `outliers: ['icon_d2']` ausweisen.

### Baustein D — AI-Prompt auf Datenqualität konditionieren

Problem: AI-Text formuliert „recht sonnig" auch wenn nur 1 Modell zur Bewölkung beiträgt.

Umsetzung im AI-Prompt-Aufbau (gleicher File, Funktion die den OpenAI-Prompt baut):
- Aus `by_model` pro Variable `n_effective` zählen (Modelle mit echtem Wert, ohne ARPEGE-Lückenfüller).
- Neuer Block am Anfang des Prompts:
  ```
  DATENQUALITÄT:
  - Bewölkung: nur 1 Modell — vorsichtig, neutrale Floskeln, keine Aussagen wie "sonnig"
  - Sonne: Spread 7.7 h zwischen Modellen — Unsicherheit benennen
  - Niederschlag: 4 Modelle einig — sicher
  ```
- Schwellen: `n_effective < 2` → „vorsichtig", `spread > schwelle` → „Unsicherheit benennen".

### Reihenfolge & Verifikation

1. C zuerst (mechanische Aggregation) — Reproduktion mit Samstag-Daten: erwartetes Ergebnis Sonne ~2-3 h statt 4.3 h.
2. D danach — manueller Prompt-Diff für Samstag prüfen.
3. Beide Bausteine laufen erst beim nächsten Cron-Run (04:15 UTC) live; manueller Trigger via `/api/public/hooks/daily-forecast` für sofortigen Test.

### Technische Details

- Keine Änderungen an DB-Schema oder UI nötig.
- `by_model` bekommt zusätzliche Felder; Konsumenten (Frontend `WeatherDataView`) ignorieren unbekannte Felder bereits.
- Gewichte für Trimming und Schwellen als Konstanten oben im File, damit später ohne Logik-Eingriff justierbar.
