## Problem

Der Trend Tag 6–10 ist heute eine reine LLM-Paraphrase von tagesaggregierten Punktwerten (Temp, Niederschlag, Wind) für Amriswil. Die Großwetterlage — also die **räumliche Verteilung von Hoch- und Tiefdruck über Europa** und die daraus folgende Strömung — wird der KI gar nicht als Datum mitgegeben. Folge: schwammige, generische Sätze ohne synoptischen Bezug.

Der gewünschte Output (Beispiel User): „Tiefdruckgebiet zwischen Mitteleuropa und dem Balkan. Sonnige Abschnitte wechseln sich mit Schauern oder Gewittern ab, vor allem in der zweiten Tageshälfte. Höchsttemperaturen zwischen 16 und 22 Grad."

Das verlangt drei Dinge, die heute fehlen:
1. Echte **MSLP-Felder über Europa** für Tag 6–10 (nicht nur Punktwert Amriswil)
2. Eine **automatische Synoptik-Auswertung** (wo liegen die Tiefs/Hochs, welche Strömung folgt daraus)
3. Einen **Temperaturbereich** für den Trendzeitraum (anders als bisher: konkrete Spanne ist erwünscht)

## Lösung

### 1. Neuer Server-Helper `src/server/synoptic-trend.server.ts`

Funktion `fetchSynopticTrend(days: 6..10)`:

- Holt von Open-Meteo **`pressure_msl`** (und optional `geopotential_height_500hPa`) auf einem groben Europa-Gitter — vorgeschlagen: 8×6 Punkte (35°N–60°N, 5°W–30°E, Schritt ~5°), Modell `ecmwf_ifs025` (gleiche Quelle wie Langfrist).
- Für jeden Tag jeweils **12 UTC** als Referenzzeit.
- Pro Tag eine kompakte Auswertung berechnen:
  - **Tiefdruck-Schwerpunkte**: lokale Minima im MSLP-Gitter (Wert < 1010 hPa und kleiner als alle 4 Nachbarn) → Liste `{lat, lon, hPa, region}` (Region per Bounding-Box-Lookup: „Britische Inseln", „Nordsee", „Skandinavien", „Mitteleuropa", „Balkan", „Mittelmeer", „Iberische Halbinsel", „Nordatlantik")
  - **Hochdruck-Schwerpunkte**: analog, Wert > 1018 hPa, lokale Maxima.
  - **Strömung über der Alpennordseite** (Punkt 47.5°N/9.3°E): aus Druck-Gradient zu Nachbarn → grobe Richtung („Süd-West", „Nord-West", „Ost", „Nord", „Süd", „West") und Stärke („schwach"/„kräftig", basierend auf Δp/100 km).
- Aggregation über Tage 6–10:
  - **Dominante Lage**: häufigste Tief-Region und häufigste Hoch-Region.
  - **Vorherrschende Strömung**: Modus der Tagesrichtungen.
  - **Lagewechsel**: ja, wenn dominant Tief/Hoch zwischen Tag 6 und 10 die Region wechseln.
- Zusätzlich: aus den bereits vorhandenen `trendDays` (lokale Punkt-Daten Amriswil) **Tmax-Spanne min/max** und **Niederschlagstendenz** (Anzahl nasser Tage bei rr ≥ 1 mm).

Output-Schema (JSON, kompakt für LLM):

```json
{
  "period": "Tag 6–10",
  "synoptic": {
    "dominant_low": { "region": "Mitteleuropa/Balkan", "avg_hPa": 1004 },
    "dominant_high": { "region": "Nordatlantik", "avg_hPa": 1022 },
    "flow_alps": "Süd-West, kräftig",
    "regime_change": false
  },
  "local_trend": {
    "tmax_range_c": [16, 22],
    "wet_days": 3,
    "character": "wechselhaft"
  },
  "per_day": [
    { "date": "...", "lows": [...], "highs": [...], "flow": "..." }
  ]
}
```

### 2. Caching

Über bestehende `getOrSetCache` aus `weather-cache.server.ts`, Key `synoptic-trend-{YYYYMMDD}`, TTL bis Mitternacht Zürich (Default).

### 3. Prompt-Anpassung an drei Aufrufstellen

`forecast.functions.ts` Z. 2782 + Z. 2942 und `forecast.auto.ts` Z. 880:

Vor der Generierung `synoptic = await fetchSynopticTrend(...)` aufrufen und dem User-Prompt mitgeben:

```
Schreibe einen 3–4-sätzigen Trend für die Tage 6–10. Verlangt:
- Satz 1: Großwetterlage benennen — Position der dominanten Tief- und 
  Hochdruckgebiete + resultierende Strömung über der Alpennordseite. 
  Beispielton: "Tiefdruckgebiet zwischen Mitteleuropa und dem Balkan, 
  Hochdruckkeil über dem Nordatlantik."
- Satz 2: Wettercharakter, der sich daraus ergibt (Sonne/Bewölkung, 
  Schauer/Gewitter, Frontendurchgang etc.) — mit Tageszeitangabe wenn 
  relevant ("vor allem in der zweiten Tageshälfte").
- Satz 3: Temperaturbereich als Spanne ("Höchsttemperaturen zwischen X 
  und Y Grad") — Werte aus local_trend.tmax_range_c.
- Optional Satz 4: Tendenzwechsel innerhalb des Zeitraums, falls 
  regime_change=true.
Keine Wochentagsnennung, keine tagesgenauen Werte, Nominalstil.

Synoptische Lage:
{synoptic-json}
```

Dabei die alte Vorgabe „keine konkreten Temperaturen" **entfernen** — User möchte explizit eine Spanne.

### 4. Fallback bei Rate-Limit / Fehler

Wenn `fetchSynopticTrend` wirft (z. B. Open-Meteo Tageslimit), den Trend wie heute aus den lokalen `trendDays` ohne Synoptik generieren — aber mit Hinweis im Log und ohne Hoch/Tief-Behauptungen.

### 5. Nominalstil + Frostwarn

Das bestehende `generateTextNominal` und die Post-Processing-Kette bleiben unverändert — Trend läuft schon hindurch.

## Test

Nach Umsetzung den aktuellen Forecast neu generieren (Trend-Eintrag) und prüfen:
- Erster Satz nennt konkrete Tief- und Hochdruck-Region.
- Dritter Satz enthält eine Tmax-Spanne.
- Inhalt deckt sich grob mit https://www.meteoschweiz.admin.ch/#tab=forecast-map (Plausibilitäts-Spotcheck, keine 1:1-Übereinstimmung erwartet).

## Außerhalb des Umfangs

- Keine UI-Änderung in den Settings.
- Keine eigene Pressure-Karte für Tag 6–10 im Frontend.
- Kein Wechsel des Synoptik-Modells (bleibt ECMWF IFS).
