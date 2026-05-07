## Antwort

**Aktueller Zustand:** Ab Tag 2 gibt es keinen Stundenverlauf mehr — also weder `hourly_profile` noch `precip_distribution` noch `sky_pattern` / `fog_dissipation`. Das hat zwei Gründe:

1. **Bewusste Sperre im Code:** In `formatDayData()` (Zeile 1326–1333) sind diese Felder hart auf `dayIndex <= 1` begrenzt.
2. **Datenquelle:** Die Stundendaten (`weather.hourly`) werden ausschliesslich aus dem **Kurzfrist-Set** geladen (`shortData?.hourly`, Zeile 710). Die Kurzfrist-Modelle (ICON-CH1/CH2, AROME-HD, ICON-D2) liefern nur ~48–72h Stundendaten — für Tag 3+ wären sie ohnehin leer.

Die Mittelfrist-Modelle (ICON-D2, ICON-CH2, ECMWF, ARPEGE) **können** Stundendaten bis Tag 4–5 liefern — aktuell werden diese aber gar nicht abgefragt (`fetchOpenMeteoOptional(..., false)` mit `includeHourly=false`).

## Ist das technisch lösbar? Ja, mit Einschränkungen

### Plan

**1. Mittelfrist mit Stundendaten abrufen**
In `fetchWeather()` (Zeile 690–691) den Mittelfrist-Aufruf von `includeHourly=false` auf `true` umstellen. Das vergrössert die Open-Meteo-Antwort spürbar (4 Modelle × ~120 Stunden × ~10 Variablen) — aber Open-Meteo liefert das in einer Antwort.

**2. Hourly-Quelle pro Tag wählen**
Eine kleine Helper-Funktion `pickHourlySource(dayIndex, weather)` ergänzen, die:
- Tag 0–1 → `shortData.hourly` (wie bisher, feinste Auflösung CH-Modelle)
- Tag 2–4 → `midData.hourly` (ICON-D2, ICON-CH2, ECMWF, ARPEGE)
- Tag 5+ → `null` (Stundendaten ab hier zu unsicher / nicht verfügbar)

**3. Sperre in `formatDayData` lockern**
Aus `dayIndex <= 1` wird `dayIndex <= 4` für `precip_distribution`, `hourly_profile`, `sky_pattern`, `fog_dissipation`. Die `buildHourlyProfile`/`detectFogDissipation`-Aufrufe nutzen die neue `pickHourlySource()`.

**4. UI-Anzeige**
`WeatherDataView.tsx` zeigt das Stundenprofil bereits aus `hourly_profile` — sobald die Daten vorhanden sind, erscheint der Verlauf automatisch auch für Tag 2–4. Falls die Visualisierung Tag-spezifisch ausgeblendet wird, dort die Begrenzung entfernen.

**5. Sky-Beschreibung in der KI**
Die Sky-Logik (`buildDeterministicSkyParagraph`, `enforceSkyConsistency`) greift bereits auf `hourly_profile` und `sky_pattern` zu — sobald diese für Tag 2–4 gesetzt sind, wird die deterministische Nebel-/Sonnen-Beschreibung automatisch auch für Mittelfrist-Tage angewandt.

### Einschränkungen, die ehrlich kommuniziert werden müssen

- **Auflösung sinkt:** Mittelfrist-Modelle haben 2–11 km Gitter (statt 1 km bei ICON-CH1). Stundenverläufe sind **glatter** und unterschätzen Konvektion (Schauer/Gewitter im Sommer).
- **Streuung wächst:** Ab Tag 3 weichen die Modelle stärker voneinander ab. Der Ensemble-Mittelwert kann den Tagesverlauf **verwaschen** (z.B. Mittag-Schauer in Modell A, Abend-Schauer in Modell B → verteilter Niederschlag den ganzen Nachmittag).
- **Nebel-Erkennung wird unzuverlässiger:** Globalmodelle bilden Hochnebel im Bodenseebecken weniger gut ab als ICON-CH1.
- **Tag 5+ bleibt ohne Stundenverlauf:** ECMWF/GFS-Stundendaten sind dort entweder nicht mehr verfügbar oder so unsicher, dass eine "Vormittag/Nachmittag"-Aussage Pseudogenauigkeit wäre.

### Empfehlung

Variante umsetzen, **aber `dayIndex <= 3`** statt `<= 4` als Limit — also Stundenverläufe nur für Tag 2 und 3. Tag 4 bleibt rein auf Tagesaggregaten, weil dort die Modellstreuung den Verlauf bereits zu stark verwischt.
