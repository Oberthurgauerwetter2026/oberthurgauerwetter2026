# Abend/Nacht-Prognose an Tag-0-Veredelung angleichen

## Ursache der Abweichung

`formatEveningNight()` in `src/server/forecast.functions.ts` baut den ersten Eintrag (ab 12:00 Uhr Schweizer Zeit) aus **rohen, stündlichen Open-Meteo-Werten** und mittelt ungewichtet über alle geladenen Modelle. Es läuft **nicht** durch:

- MOSMIX-Mix (Tag 0: 40/60)
- Stations-Bias-Korrektur (GUT/STG/TAE)
- Radar-Korrektur (ICON-CH1 vs. ICON-D2)
- Nowcast-Anker

Der Tag-0-Tagesdatensatz, den du im Vergleich siehst, hat all das **drauf**. Daher: gleicher Tag, andere Zahl, vor allem beim Niederschlag.

Zusätzlich:
- Stündliche Modellauswahl ist nicht tier-gewichtet (Long-range-Modelle zählen gleich viel wie ICON-CH1).
- `precip_distribution` (Blöcke night/evening) hat dasselbe Problem.

## Was getan wird

### 1. `formatEveningNight()` neu skalieren
Nach Berechnung der rohen `precip_total` einen **Skalierungsfaktor** anwenden, der aus dem bereits veredelten Tag-0-Wert abgeleitet wird:

```text
factor = veredelt_tag0.precip.avg / roh_tag0.precip_sum_open_meteo
evening.precip_total *= factor
```

Begründung: das Verhältnis aus „mit Mix+Bias+Radar" zu „nur OM-Roh" am Gesamttag ist die beste Annäherung daran, wie sich diese Korrekturen auf das Restfenster auswirken. Vermeidet, das ganze MOSMIX/Bias/Radar-Pipeline-Konstrukt stundenscharf neu zu bauen.

Edge cases:
- roher Tagessumme ≈ 0 → factor = 1 (keine Skalierung), aber wenn Radar/Nowcast Niederschlag liefert → `evening.precip_total = max(evening.precip_total, radar.next_2h_mm)`.
- factor auf [0.3, 3.0] deckeln (gleich wie Radar-Korrektur).

### 2. `nowcast` & `radar` direkt einfließen lassen
- Wenn Radar-Snapshot für die nächsten 2h Niederschlag zeigt (`radar.forecast_next_2h.next_2h_mm > 0`) und das Fenster die nächsten Stunden umfasst: `evening.precip_total = max(skalierter_wert, next_2h_mm)`.
- Diese Werte stehen schon im `weather_data` des Tag-0-Eintrags zur Verfügung.

### 3. `precip_distribution` (night/evening Blöcke) gleich skalieren
Auf die zwei Blöcke „evening" und „night" denselben factor anwenden, damit die Block-Beschreibung im Prompt konsistent zur Tagessumme bleibt.

### 4. Tier-Gewichtung in `formatEveningNight`
Stündliche Modelle nach derselben Tier-Logik gewichten wie `collectModelValuesTiered` (Short > Mid > Long). Long-range-Modelle (GFS, IFS) werden für das Restfenster heute praktisch ignoriert.

### 5. Im `weather_data` ablegen
- `evening.precip_total_raw_om` (vor Skalierung)
- `evening.precip_scale_factor`
- `evening.precip_sources` (welche Korrekturen aktiv waren)

So sieht man im UI (`WeatherDataView`) genau, woher die Differenz kommt.

## Geänderte Dateien

- `src/server/forecast.functions.ts` — `formatEveningNight`, `buildFirstEntryContext`, Übergabe der Tag-0-Aggregate
- `src/components/WeatherDataView.tsx` — neuen Block für Abend/Nacht-Veredelung anzeigen

## Erwartetes Verhalten

Niederschlag im Abend/Nacht-Eintrag liegt nahe am, was du in den Modellen + Radar manuell siehst, statt eines reinen ungewichteten OM-Mittelwerts. Temperatur/Wind bleiben unverändert (dort ist die Abweichung typischerweise klein und Bias würde auf Stundenebene mehr Aufwand bedeuten — kann später nachgezogen werden).
