# Feinere Stunden-Auflösung für Tag 0 + Tag 1

## Ziel

Statt 4 grober Blöcke (night/morning/afternoon/evening) und einem Tages-Aggregat sollen die Stunden 00–24 für Tag 0 und Tag 1 **stundenweise** aus allen verfügbaren Quellen ausgelesen, gegeneinander geprüft und zu einem "best estimate per hour" zusammengeführt werden. Daraus werden anschliessend die Aggregate (tmin/tmax/precip/wind/sun) **abgeleitet** — nicht umgekehrt.

## Warum das Tag 0 + Tag 1 verbessert

- Die heutigen Schwächen sitzen oft in *einzelnen* Stunden (z. B. Schauer 14–16 Uhr, Föhnabbruch um 22 Uhr, Stratusauflösung 11 Uhr). Eine Block-Mittelung verwischt das.
- Tag 0: vergangene Stunden sind durch SMN/Radar **gemessen** und können das Modell direkt überschreiben.
- Tag 1: Modellunterschiede sind stundenweise oft drastisch (CH1 vs. CH2 vs. ECMWF). Erst durch Stunden-Vergleich erkennt man, *wo* die Modelle einig/uneinig sind.

## Pipeline (neu)

```text
Stunde 00 .. 23
  ├── Quellen je Stunde:
  │     - Open-Meteo Multi-Modell (CH1, CH2, AROME, ICON-D2)  → temp, precip, wind, cloud, sun, rh
  │     - MOSMIX (sofern stündlich verfügbar)
  │     - SMN-Beobachtung (für vergangene Stunden Tag 0)
  │     - Radar-Nowcast (precip, 0–6 h)
  ├── Pro Stunde:
  │     1) Wenn beobachtet (SMN/Radar) → Beobachtung gewinnt, Modell wird "rebased"
  │     2) Sonst: gewichtetes Modell-Median + Spread
  │     3) Stations-Bias (stundenweise) anwenden
  │     4) Plausibilitätscheck (Sprungfilter, physik. Grenzen)
  └── Output: hourly_profile[24] mit value + confidence + source
↓
Aggregate (tmin/tmax/precip_sum/wind_max/...) aus dem Profil ableiten
↓
precip_distribution aus dem Profil neu rechnen (feinere Blöcke + peak_hour)
↓
KI-Prompt bekommt: hourly_profile (kompakt) + Aggregate + Konfidenz
```

## Umsetzung in Schritten

### Schritt 1 — `buildHourlyProfile(weather, dayIndex, options)` neu in `forecast.functions.ts`
- Liest aus `weather.hourly` und `weather.byModel.*.hourly` für Tag `dayIndex`.
- Pro Stunde Median **und** Spread (max−min) je Variable.
- Rückgabe: `Array<{ hour: number; iso: string; temp: {value, spread, models}; precip: {...}; wind: {...}; cloud, sun, rh, source }>`.
- Variablen: temperature_2m, precipitation, precipitation_probability, wind_speed_10m, wind_gusts_10m, cloudcover, sunshine_duration, relative_humidity_2m.

### Schritt 2 — Beobachtungs-Overlay für Tag 0
- In `nowcast.server.ts` bzw. neuem Helper: Liste aller bereits beobachteten Stunden (SMN + Radar) → in Profil einsetzen mit `source: "observed"` und `confidence: 1`.
- Für die Stunde *jetzt* zusätzlich: Übergangs-Smoothing (ersten 1–2 zukünftigen Stunden in Richtung Beobachtung verschieben — verhindert Sprünge).

### Schritt 3 — Stundenweiser Stations-Bias
- `bias-correction.server.ts` erweitern: Bias zusätzlich pro Stunde-im-Tag (24 Werte) statt nur Tagesmittel; konservativ glätten (gleitendes 3-Stunden-Mittel).
- Anwendung im Profil pro Stunde, nicht auf das Tages-Aggregat.

### Schritt 4 — Plausibilitätsfilter pro Stunde
- Temperatursprünge > 4 °C/h glätten (ausser bei Föhn/Gewitter-Markern).
- Niederschlag-Spitzen, die nur ein Modell zeigt und Spread > 5 mm → dämpfen, Spread als Unsicherheit melden.
- Wind: wenn Gust < Speed → Gust = Speed (Datenfehler).

### Schritt 5 — Aggregate aus Profil ableiten
- `formatDayData` / `refineDayFromHour` ersetzen durch `aggregateFromProfile(profile, fromHour)`.
- tmin/tmax aus Profil-Min/Max der gewünschten Stunden, Niederschlagssumme aus Profil-Summe, Wind-Max aus Profil-Max, Sonnenstunden aus Summe.
- Tag 0 voll (00–24 mit Beobachtungs-Overlay), Tag 1 ab 06:00 (wie bereits gelöst).

### Schritt 6 — Feineres `precip_distribution`
- Statt 4 Blöcke: weiterhin 4 Blöcke ausgeben *plus* `peak_hour` (Stunde mit dem höchsten Niederschlag) und `dry_windows` (zusammenhängende trockene Phasen ≥ 3 h).
- KI-Prompt-Hinweis: "Wenn `peak_hour` vorhanden, Stundenangabe nennen ('um den Mittag', 'gegen 17 Uhr')."

### Schritt 7 — KI bekommt kompaktes Stundenprofil
- Neuer Prompt-Block: `hourly_profile_compact` als Tabelle (24 Zeilen, nur Schlüsselwerte). Reduziert Halluzinationen über Tagesgang.
- Klare Regel: bei hoher Spread → vorsichtig formulieren; bei `source: "observed"` → als Beobachtung beschreiben.

## Datenstruktur (Beispiel)

```text
hourly_profile: [
  { h: 14, value: { temp: 8.2, precip: 0.4, wind: 18, cloud: 90, sun: 0 },
    spread: { temp: 0.6, precip: 1.2, wind: 5 },
    source: "model_median", confidence: 0.8 },
  { h: 15, value: { temp: 8.0, precip: 2.1, wind: 22, cloud: 95, sun: 0 },
    spread: { temp: 0.4, precip: 3.5, wind: 7 },
    source: "radar_nowcast", confidence: 0.95 },
  ...
]
```

## Reihenfolge der Implementierung (vorgeschlagene Iterationen)

1. **Profil-Builder + Aggregat-Ableitung** (Schritte 1, 5) — sofort verwendbar, ersetzt `formatDayData` ohne Verhaltensänderung.
2. **SMN/Radar-Overlay Tag 0** (Schritt 2) — direkter Qualitätsgewinn für die ersten Stunden.
3. **Stundenweiser Bias** (Schritt 3) — verbessert tmin/tmax-Treffer.
4. **Plausibilitätsfilter + KI-Prompt + feineres precip_distribution** (Schritte 4, 6, 7).

Jede Iteration ist eigenständig deploybar; ich schlage vor, mit Schritt 1+2 anzufangen und das Resultat zuerst zu beurteilen.

## Was *nicht* Teil dieses Plans ist

- Dynamische Modellgewichte (Skill-Tracking) — separater Folgeschritt.
- Wetterlagen-Detektoren (Föhn, Stratus, Bise) — können später auf das Profil aufgesetzt werden.
- Probabilistische Niederschlagsausgabe (Perzentile / P>1 mm) — explizit zurückgestellt.

## Risiken / offene Punkte

- MOSMIX liefert teils nur tägliche Aggregate; bleibt dann als "Tagesplausibilität" erhalten, nicht als Stundenquelle.
- Mehr Daten im KI-Prompt = mehr Tokens. Profil daher kompakt formatiert (eine Zeile pro Stunde, gerundete Werte).
- Datenschemata in `weather_data` (forecast_entries) wachsen — bestehende Einträge bleiben kompatibel, neue Felder sind additiv.
