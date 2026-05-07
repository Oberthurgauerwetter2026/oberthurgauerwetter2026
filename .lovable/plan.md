# Warum die Freitagsprognose zu sonnig wirkt

## Diagnose (aus den gespeicherten `weather_data` von Position 2)

Für Freitag, 8. Mai liegen die Modelle ungewöhnlich weit auseinander:

| Grösse | ICON-CH1 (MCH) | ICON-CH2 (MCH) | ICON-D2 (DWD) | AROME (MF) | aggregierter Wert im Text |
|---|---|---|---|---|---|
| Tmax °C | **14.4** | 20.7 | 19.4 | **21.5** | „um 20 Grad" (avg 18.8) |
| Sonnenstunden | **3.6 h** | 10.9 h | 12.5 h | – | avg ≈ 9 h |
| Weathercode | – | 3 (klar) | 45 (Nebel) | – | gemischt |
| Tmax-Spread | **7.1 K** über 4 Modelle | | | | |

Das **MCH-Modell ICON-CH1** sieht den Tag deutlich kühler und bewölkter (vermutlich mit Nebelresten / Hochnebel-Auflösung erst spät). Die anderen drei Modelle sehen den Tag sonnig und mild. Die aktuelle Aggregation bildet einfach das **arithmetische Mittel über alle Modelle**, ohne MCH-Vorrang. Resultat: ICON-CH1 wird zur Minderheit überstimmt → Text fällt zu sonnig aus.

Zusätzlich:
- `cloudcover.avg = 64.8` ist irreführend, weil im `by_model` **nur ICON-D2 = 75.9** vorhanden ist (die anderen Modelle liefern für diesen Parameter nichts). Der Durchschnitt wird also faktisch von einem einzigen Modell bestimmt — und trotzdem als „Mittel über alle" präsentiert.
- Im `hourly_profile` schwankt `c` (cloudcover) zwischen 40 und 100 von Stunde zu Stunde — das ist Mittelungsrauschen unterschiedlicher Modell-Grids, kein realer Aufklarungs-Verlauf. Das KI-Modell interpretiert die kurzen Tiefstwerte als „zunehmend sonnige Abschnitte".
- Die `MODELL-UNSICHERHEIT`-Regel im Prompt feuert ab Spread > 3 — bei Tmax-Spread 7.1 müsste der Text deutlich vorsichtiger formulieren („verbreitet stark bewölkt, gegen Mittag eventuell Aufhellungen"). Das passiert aber nicht zuverlässig, weil im Übergabe-JSON die Spread-Werte für `cloudcover` und `sunshine_h` nicht prominent neben dem `avg` stehen.

## Plan zur Behebung

### 1. MeteoSchweiz-Vorrang bei Aggregation (Hauptursache)
In `aggregate()` und `collectModelValuesTiered()` (forecast.functions.ts) gewichtete Mittelung einführen:
- ICON-CH1 = Gewicht 2.0
- ICON-CH2 = Gewicht 1.5
- AROME-HD, ICON-D2 = Gewicht 1.0
- ICON-EU, ECMWF, GFS = Gewicht 0.7

Effekt für Freitag: Tmax sinkt von 18.8 auf ≈ 17.6, Sonnenstunden von 9 auf ≈ 7. Der Text wird automatisch zurückhaltender.

### 2. Spread-Hinweis explizit ins JSON
Pro Aggregat-Feld (`tmax`, `cloudcover`, `sunshine_h`) ein Flag `disagreement: "high" | "moderate" | "low"` ergänzen, basierend auf der Spread-Schwelle (z. B. Tmax > 5 K = high). Das Flag wird im Prompt prominent erwähnt, sodass die KI bei `high` zwingend zurückhaltend formulieren muss.

### 3. Cloudcover-Aggregation reparieren
Wenn nur ein einziges Modell den Wert liefert (`Object.keys(by_model).length === 1`), als `source: "single_model"` markieren und im Prompt als unsicher kennzeichnen — statt einen scheinbaren Mittelwert auszugeben.

### 4. Hourly-Profile-Glättung
Im `hourly_profile` für `c` (cloudcover) ein 3-Stunden-Median-Filter anwenden, damit kurzzeitiges Rauschen (40 → 100 → 49 innerhalb von 2 h) nicht als realer Wettereffekt interpretiert wird.

### Was nicht geändert wird
- Bias-Korrektur, Stationsdaten, Radar-Korrektur, Topographie-Logik bleiben unverändert.
- Der Prompt-Text-Stil (keine „gemessen"-Begriffe usw.) bleibt unverändert.
- Tag-1-Tiefstwerte-Logik bleibt unverändert.

## Konfigurierbarkeit
Die Modell-Gewichte werden in `app_settings` als Spalten (z. B. `weight_icon_ch1`, `weight_icon_ch2` …) abgelegt, mit den oben genannten Defaults — so kannst du sie ohne Code-Änderung tunen, falls ICON-CH1 in einer anderen Wetterlage übergewichtig wird.
