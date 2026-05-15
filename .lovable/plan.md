## Befund — warum die Samstag-Prognose gegen ICON-CH1/CH2 + AROME schlecht ist

Drei strukturelle Probleme in den Daten, die ich aus dem gespeicherten `weather_data` von Eintrag 2 (Samstag) und einem Live-Probe-Call gegen Open-Meteo identifiziert habe.

### 1. Bewölkung Samstag stützt sich auf die *falschen* Modelle

Daten in der Prognose:
```
cloudcover.by_model: { arpege_europe: 62, icon_d2: 85.9 }   →   avg 76 %
```

Live-Probe gegen Open-Meteo (Zürich-Region, Samstag 16.5.):

| Variable          | ICON-CH1 | ICON-CH2 | AROME-HD | ICON-D2 |
|---|---|---|---|---|
| `cloudcover_mean` (daily)  | null | **null** | null | 84   |
| `cloudcover` (hourly Sa.)  | 0/24 | **0/24** | 0/24 | 24/24 |

Open-Meteo liefert für Samstag **bei keinem der drei vom Nutzer bevorzugten Modelle** Bewölkungswerte — weder daily noch hourly. Deshalb füllt `fillFromDay` mit ARPEGE-Europe (Mid-Tier, 25 km Raster) auf. Bewölkung Samstag = ICON-D2 + ARPEGE. **Die Modelle, an denen der Nutzer den Fehler diagnostiziert (CH1/CH2/AROME), tragen zur Bewölkung null bei.**

### 2. Sonnenscheindauer Samstag — Konsens kaputt durch ICON-D2

```
sunshine_h.by_model: { icon_d2: 8.6, ch1: 0.9, ch2: 5.9 }   →   gewichtet 4.3 h
```

Spread 7.7 h ist riesig. AROME hat keine `sunshine_duration` (Open-Meteo liefert nichts). ICON-D2 sagt 8.6 h, CH1 nur 0.9 h. Trotz Gewichtung CH1+CH2 = 0.79 wird der Mittelwert auf 4.3 h hochgezogen, weil ICON-D2 mit 8.6 h ein Ausreisser ist. Der Text spricht von „recht sonnig" — passt zu D2, widerspricht CH1/CH2.

### 3. Niederschlagswahrscheinlichkeit Samstag wirkt verdächtig: gleiche Werte wie Freitag

Freitag (Tag 0):
```
precip_prob.by_model: { meteoswiss_icon_ch1: 73, meteoswiss_icon_ch2: 62 }
```
Samstag (Tag 1):
```
precip_prob.by_model: { meteoswiss_icon_ch1: 73, meteoswiss_icon_ch2: 62 }   ← identisch
```

Live-Probe gegen Open-Meteo, Samstag hourly `precipitation_probability`:

| Modell | Stunden mit Werten | Max |
|---|---|---|
| ICON-CH1 | 10/24 (nur ~h+33) | 64 |
| ICON-CH2 | 24/24             | 33 |
| AROME    | 0/24              | – |
| ICON-D2  | 0/24              | – |

Die wahren Samstag-Maxima wären **ch1=64, ch2=33** — bei uns steht aber **73/62**, die exakten Tag-0-Werte. Das deutet auf einen Daten-Übernahme-Bug zwischen Tag 0 und Tag 1 in `refineDayFromHour` oder `formatDayData`. Effekt: Samstag wird mit zu hoher Niederschlagswahrscheinlichkeit (avg 68 %) gerechnet, obwohl der Konsens der Modelle bei ~30 % liegt.

### 4. Konsequenz für `models_used`

```
models_used: meteoswiss_icon_ch1, meteoswiss_icon_ch2, meteofrance_arome_france_hd, icon_d2, arpege_europe
```

Die Liste suggeriert 5 Modelle — tatsächlich tragen je nach Variable nur 1–3 echte Modelle bei. Bewölkung: 1 (D2) + 1 ARPEGE-Lückenfüller. Wind-Max: 1 effektives Modell mit Gewicht 1.0. Niederschlagswahrscheinlichkeit: aktuell wahrscheinlich von Tag 0 dupliziert.

---

## Plan (Behebung in 4 Bausteinen)

### Baustein A — Niederschlagswahrscheinlichkeit-Duplikat aufspüren
Reproduktion durch lokales Aufrufen von `formatDayData(weather, 1)` und `refineDayFromHour(day, weather, 1, 0)` mit dem Live-Open-Meteo-Snapshot. Erwartung: einer der Pfade liest fälschlich `daily.precipitation_probability_max[0]` statt `[1]`. Wahrscheinlichste Verdächtige:

* `collectModelValuesTiered` → `collectModelValues` mit dayIndex (Index-Off-by-one).
* `fillFromDay` zieht aus dem Vortags-`day`-Objekt, weil `day` nicht für Tag 1 sondern Tag 0 übergeben wurde (Aufrufstelle prüfen).

Fix punktuell, mit Unit-artigem Test im selben File.

### Baustein B — Daily-Lücken bei CH-/AROME-Modellen aus Hourly nachrechnen
Wenn `daily.<var>` für ein Modell `null` ist, aber `hourly.<var>_<modell>` Werte hat, **selbst aggregieren** statt das Modell zu verlieren. Das ist heute nur teilweise drin (`refineDayFromHour` macht's, aber für Bewölkung Samstag hat *auch hourly* nichts). Wenn auch hourly leer ist, das Modell **dokumentiert weglassen** statt heimlich durch ARPEGE zu ersetzen — und `models_used` ehrlich angeben.

Konkret in `formatDayData` und `refineDayFromHour`:
* Per-Variable berechnen, welche Modelle echte Daten lieferten.
* `cloudcover.by_model` bekommt ein `missing: ['ch1','ch2','arome']` Feld (oder `coverage: { effective: 1, expected: 4 }`), das im UI/AI-Prompt sichtbar wird.
* Wenn `<2 echte Hochauflösungs-Modelle` für eine Variable beitragen, `cloudcover_source` von `"model"` auf `"low_coverage"` setzen.

### Baustein C — ICON-D2-Ausreisser bei Sonne/Bewölkung dämpfen
ICON-D2 systematisch optimistischer als ICON-CH bei Sonne (vermutlich wegen anderer Wolkenschema). Im Mid-Tier-Aggregat schon Modellgewichte (`weights_used`); für Sonne/Bewölkung **Konsens-basiertes Trimming** einbauen: wenn ein Modell mehr als 1.5× p50 von p50 abweicht UND der Spread > X ist, runter-gewichten. Alternative: Median statt gewichtetes Mittel als Hauptwert wenn Spread > Schwelle.

### Baustein D — AI-Prompt auf Datenqualität konditionieren
Wenn `cloudcover_source === "low_coverage"` oder `n_effective < 2` für Bewölkung, präfixiert der Prompt: „Bewölkung nur aus 1 Modell — vorsichtig formulieren, lieber neutrale Floskeln." Verhindert „recht sonnig"-Aussagen auf dünner Datenbasis.

## Reihenfolge

1. **A zuerst** — der Datenduplikat-Bug ist ein klarer Fehler und kostet wenig.
2. **B** — strukturelle Härtung, mittlerer Aufwand.
3. **C/D** — feinere Justierung, abhängig davon ob A+B die Prognose schon ausreichend verbessern.

## Frage vor Umsetzung

Soll ich direkt mit **Baustein A** beginnen (Niederschlagswahrscheinlichkeit-Duplikat-Bug suchen und fixen) und **Baustein B** in der gleichen Iteration mitmachen? Oder erst nur A, dann separat über B/C/D entscheiden?
