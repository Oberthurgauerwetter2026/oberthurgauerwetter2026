## Ziel

Die Bewölkungs- und Sonnenscheinbeurteilung in der Prognosegenerierung soll präziser und aussagekräftiger werden. Heute wird hauptsächlich mit zwei Tages-Aggregaten gearbeitet (`cloudcover_mean` total + `sunshine_duration`), ergänzt um eine Tagesgang-Heuristik nur für Niederschlag. Daraus entstehen Schwächen wie:

- "Sonnig" vs. "bedeckt" wird ohne Schichtinformation entschieden (hohe Schleierwolken werden gleich behandelt wie Hochnebel).
- Hochnebel-Lagen werden nur grob via cloud + sun + WMO-Code 45/48 erkannt.
- Modelle werden für Bewölkung/Sonne ungewichtet gemittelt — anders als beim Wind, wo ICON-CH1/2 + AROME HD bereits gewichtet sind.
- Es gibt keinen Tagesgang-Block (Vormittag/Nachmittag/Abend) für Bewölkung & Sonne wie bei Niederschlag.

Es gibt mehrere konkrete Verbesserungs­hebel. Der Plan beschreibt sie als Bausteine — wir setzen sie schrittweise um, nicht alle in einem Rutsch.

## Verbesserungs-Bausteine

### 1. Wolkenschichten Low / Mid / High (höchster Hebel)

Open-Meteo liefert pro Modell zusätzlich `cloudcover_low`, `cloudcover_mid`, `cloudcover_high`. Damit lässt sich z. B. unterscheiden:

- viel `cloud_high`, wenig low/mid → "hohe Schleierwolken, Sonne meist durchscheinend"
- viel `cloud_low` morgens → Hochnebel-Indikator (zusammen mit niedrigem `sunshine_duration`)
- viel `cloud_mid` + wenig low → Altostratus, eher trüb aber kein Nebel

Umsetzung:
- `HOURLY_VARS` um die drei Schicht-Variablen erweitern.
- In `formatDayData` zusätzliche Aggregate `cloudcover_low/mid/high` (Tagesmittel und Vormittag/Nachmittag-Splits).
- In `classifySky` neue Regeln voranstellen, bevor die generischen Schwellen greifen.

### 2. Tagesgang-Block für Bewölkung & Sonne

Analog zu `computePrecipDistribution` einen `computeCloudSunDistribution` einführen, der für die vier Blöcke (Nacht, Vormittag, Nachmittag, Abend) liefert:

- mittlere Gesamtbewölkung,
- mittlere Tiefe Bewölkung (für Hochnebel-Erkennung pro Block),
- Summe Sonnenminuten,
- Anteil Stunden mit ≥ 30 min Sonne ("sonnige Stunden").

Diese Blöcke speisen `classifySky` und werden zusätzlich im `WeatherDataView` angezeigt (analog zum Niederschlags-Tagesgang).

### 3. Modell-Gewichtung für Bewölkung/Sonne

Heute ist Bewölkung/Sonne ungewichtet, obwohl die hochauflösenden Modelle (ICON-CH1/2, AROME HD, KNMI/DMI Harmonie) das Mittelland besser auflösen. Wir führen eine separate Gewichtung ein (nicht die Wind-Gewichte wiederverwenden) — z. B.:

```text
meteoswiss_icon_ch1: 0.30
meteoswiss_icon_ch2: 0.25
icon_d2:             0.15
meteofrance_arome_france_hd: 0.15
icon_eu:             0.10
ecmwf_ifs025:        0.05
```

Anwendung in `formatDayData` für `cloudcover_mean`, die neuen Schicht-Variablen und `sunshine_duration`. Fallback auf ungewichtetes Mittel, wenn keine gewichteten Modelle vorliegen.

### 4. Strahlungs-Proxy statt Sonnenminuten (optional, kleiner Hebel)

Open-Meteo liefert `shortwave_radiation` und `direct_radiation` (W/m²). Diese sind robuster gegen Modell-Diskretisierung als `sunshine_duration` (das pro Stunde nur 0/15/30/45/60 min liefert). Geplant nur als interner Konsistenz-Check: wenn Strahlung hoch, aber Sonnenminuten klein → mehr "Sonne" annehmen (und umgekehrt). Wir geben diesen Wert nicht direkt aus, korrigieren aber den `sunshine_h`-Aggregat in `formatDayData`.

### 5. Hochnebel-Erkennung verbessern

`detectFogDissipation` verwendet bisher Gesamtbewölkung. Mit `cloudcover_low` wird die Erkennung deutlich treffsicherer:

- Trigger: morgens `cloud_low` ≥ 80 % UND `cloud_mid+high` < 60 % UND wenig Sonne.
- Auflösung: Stunde, ab der `cloud_low` < 60 % ODER Sonne ≥ 20 min.
- Damit verschwindet der jetzige Schönwetter-Fehlbefund bei dichten hohen Schleierwolken (die heute fälschlich als "Hochnebel" zählen können, weil cloud_total hoch ist).

### 6. Konsistenz-Guardrails für die KI-Generierung

In den Prompt (siehe `formatDayData` → Sky-Klassifikation) explizit aufnehmen:

- Wenn `cloud_low_morning ≥ 80 %` → keine Formulierung "von Beginn an sonnig" zulassen.
- Wenn `cloud_high_avg ≥ 60 %` und `cloud_low+mid ≤ 30 %` → bevorzugte Formulierung "Sonne durch hohe Schleierwolken / leicht milchig".
- Wenn Modell-Streuung (`spread`) bei `cloudcover_mean` > 30 % → Wort "wechselnd bewölkt" zulässig statt definitiver Aussage.

Diese Regeln existieren teils implizit über `sky_pattern`, aber nicht explizit als Prompt-Constraints. `nominal-style.server.ts` ist dafür bereits der etablierte Ort (analog zur Nacht-Sonne-Regel).

## Empfohlene Reihenfolge

1. Baustein 1 (Schichten) + Baustein 5 (Hochnebel mit Schichten) — zusammen, weil Baustein 5 auf 1 aufbaut.
2. Baustein 2 (Tagesgang-Block) — verbessert sowohl `classifySky` als auch das Debug-UI.
3. Baustein 3 (Gewichtung).
4. Baustein 6 (Prompt-Guardrails).
5. Baustein 4 (Strahlungs-Proxy) — nur falls die ersten vier nicht reichen.

## Klärungsfragen

Bevor ich loslege, brauche ich von dir:

1. **Umfang**: Sollen wir alle Bausteine auf einmal umsetzen, oder erstmal nur Baustein 1+5 (Schichten + bessere Hochnebel-Erkennung) als spürbare erste Verbesserung?
2. **API-Limit**: Die drei zusätzlichen Schicht-Variablen (`cloudcover_low/mid/high`) erhöhen die Open-Meteo-Antwortgröße um ~15 %, die API-Call-Zahl bleibt gleich. OK?
3. **Anzeige im UI**: Sollen die neuen Schichtinformationen auch in der `/forecast/...`-Detailansicht (`WeatherDataView`) sichtbar sein, oder nur intern für die Generierung verwendet werden?
