## Ziel

Räumliche Differenzierung der **gesamten Prognose** datengetrieben statt sprachlich. Heute ist die Prognose faktisch eine Punktprognose von Amriswil, die per Prompt auf "Region" verallgemeinert wird. Künftig: vier Prognose-Punkte im Oberthurgau-Perimeter, alle in **einem** Open-Meteo-Call (Multi-Coord), mit Zonen-Werten im Prompt — für Temperatur, Niederschlag, Wind, Bewölkung, Sonne, **alles**. Föhn, Gewitter und Bodensee bleiben eigene Layer und greifen oben drauf wie heute.

**Verifiziert per Test-Call:** Open-Meteo akzeptiert `latitude=a,b,c,d&longitude=...` und liefert ein Array von 4 Punkt-Antworten in 1 HTTP-Call (683 ms). Quota-Verbrauch bleibt 1 Call pro Variable, nicht 4.

## Die vier Prognose-Punkte

| Zone | Ort | Lat | Lon | Wofür repräsentativ |
|---|---|---|---|---|
| Seeufer-Ost | Horn | 47.494 | 9.434 | wärmeres Seeklima Ost, Föhn-Maximum |
| Seeufer-Mitte | Romanshorn | 47.566 | 9.378 | typisches Seeklima |
| Seeufer-West | Münsterlingen | 47.633 | 9.235 | Seeklima West, abgeschwächter Föhn |
| Hinterland | Hauptwil-Gottshaus | 47.490 | 9.275 | erhöht (~580 m), kühler, windgeschützt |

Diese vier decken den Perimeter (Horn–Münsterlingen–Erlen–Hauptwil-Gottshaus–Roggwil–Horn) sinnvoll ab. Mittelpunkt aller vier (~47.55/9.33) bleibt der "primäre" Punkt für Aggregat-Aussagen (Trend, Klima, Bodensee).

## Was die Zonen-Daten in der Praxis bringen

Beispiele für **alle** Wetterlagen (nicht nur Föhn):

- **Sommerlicher Schauerlage:** "Schauer im Westen um Münsterlingen kräftiger (8 mm), im Osten um Horn nur leicht (1 mm)" — heute nicht möglich.
- **Bisenlage:** "über dem See bis 30 km/h, im Hinterland um Hauptwil deutlich schwächer".
- **Strahlungsnacht:** "Frostgefahr im Hinterland bis -3 °C, am See dank Wassereinfluss um 0 °C".
- **Hochnebel:** "Untergrenze um 700 m, See im Nebel, Hinterland Hauptwil oft schon sonnig".
- **Hitzetag:** "am See moderiert auf 28 °C, Hinterland 31 °C".
- **Föhn:** wie schon im bestehenden Föhn-Layer, aber jetzt mit echten Zonen-Zahlen statt nur Prompt-Text.

## Umsetzung in `src/server/forecast.functions.ts`

### 1. Multi-Coord-Fetch

Konstante `ZONES` mit den vier Punkten. `fetchOpenMeteo(lat, lon, ...)` erweitern um Variante `fetchOpenMeteoMulti(zones, ...)` — baut `latitude=47.494,47.566,47.633,47.490` und parst die Array-Antwort.

Antwort wird zu `byZone: { ost, mitte, west, hinterland }` umgeformt. Bestehende `byModel`-Struktur bleibt für die **Mittelpunkt-Aggregate** erhalten — wichtig für Backward-Kompat von AIFS, Bodensee, CAPE/Föhn, Trend, Klimavergleich.

**Hourly nur für Mittelpunkt** (nicht 4× — wäre 5–10 MB JSON pro Call). Für Tag-0-Tagesgang reicht das.

### 2. Zonen-Aggregation in `formatDayData`

Für **jede Tagesvariable** (tmax, tmin, precip, precip_prob, wind_max, wind_dir, cloudcover, sunshine_h) wird zusätzlich zum bestehenden Multi-Modell-Mittel ein `zones`-Block berechnet:

```ts
{
  ...bestehende Felder (unverändert),
  zones: {
    tmax:    { ost: 22.1, mitte: 21.4, west: 20.8, hinterland: 18.9, range: "18.9–22.1", spread: 3.2 },
    tmin:    { ... },
    precip:  { ost: 0.5, mitte: 1.2, west: 2.1, hinterland: 4.3, range: "0.5–4.3", spread: 3.8 },
    wind_max:{ ost: 38, mitte: 28, west: 18, hinterland: 12, range: "12–38", spread: 26 },
    cloudcover: { ... },
    sunshine_h: { ... },
    // automatische Auswertung welche Variablen relevant differieren:
    significant_diffs: ["tmax", "wind_max", "precip"]
  }
}
```

**Schwellwerte für `significant_diffs`** (definieren, was "relevant" ist):
- Temperatur-Spread > 2 °C
- Niederschlag-Spread > 3 mm oder Faktor > 3×
- Wind-Spread > 15 km/h
- Bewölkung-Spread > 30 %
- Sonnenschein-Spread > 2 h

### 3. System-Prompt-Erweiterung

Neuer Abschnitt nach FÖHN-HINWEIS:

```
=== ZONEN-DIFFERENZIERUNG (gilt für ALLE Wetterlagen) ===
Die Daten enthalten ein Feld 'zones' mit Werten für vier repräsentative
Punkte im Perimeter:
- ost: Horn (östliches Seeufer)
- mitte: Romanshorn (mittleres Seeufer)
- west: Münsterlingen (westliches Seeufer)
- hinterland: Hauptwil-Gottshaus (Hinterland, ~580 m)

REGEL: Für jede Variable, die in 'zones.significant_diffs' aufgeführt ist,
MUSS der Text die räumliche Differenzierung mit Ortsbezug erwähnen
('am östlichen Seeufer um Horn 22°C, im Hinterland um Hauptwil-Gottshaus
nur 19°C', 'Niederschlag im Westen um Münsterlingen am stärksten',
'Wind über dem See deutlich kräftiger als im Hinterland').

Bei Variablen die NICHT in significant_diffs stehen: einheitliche Aussage,
keine künstliche Aufteilung.

Erlaubte Ortsnennungen: Horn, Romanshorn, Münsterlingen, Hauptwil-Gottshaus,
sowie räumlich naheliegende (Arbon, Roggwil, Egnach, Uttwil, Altnau,
Amriswil, Erlen, Sulgen, Bischofszell). NIEMALS: Rheintal, Vaduz, Buchs,
Steckborn, Frauenfeld, Konstanz, Kreuzlingen.

Gilt für alle Wetterlagen — nicht nur Föhn. Auch bei Schauern, Bise,
Hochnebel, Frost, Hitze, etc.
```

### 4. SwissMetNet-Live-Validierung Tag 0 (optional, Phase 2)

Zwei Stationen ergänzen für Live-Bestätigung der Ost-West-Achse:
- **ARH** Altenrhein (47.485 / 9.561) — Ost-Referenz
- **GUT** Güttingen — bereits vorhanden, West-Referenz

Helper `formatLiveZoneValidation(smn, zoneData)`: vergleicht Live-Werte mit Tag-0-Prognose, ergänzt Hinweis "aktuell zeigt sich bereits ein Ost-West-Gradient von X°C" wenn Diff > 3 °C. Nur Tag 0, nur wenn Daten ≤ 2 h alt.

**Diesen Schritt machen wir in Phase 2** — erst Multi-Coord stabilisieren, dann Live-Validierung obendrauf.

### 5. Prompt-Injection

Keine neuen Block-Variablen — `zones` ist Teil von `day`/`firstData` und wird automatisch im JSON mitgesendet. Bestehende AIFS/Bodensee/Storm/Föhn-Blocks bleiben unverändert.

## Was nicht geändert wird

- AIFS, Bodensee, CAPE/Gewitter, Föhn-Helper, MOSMIX, Topografie, Güttingen-Bias: alle Helper lesen weiterhin die Mittelpunkt-Werte und funktionieren wie bisher.
- Bestehende `pickBestSource`/`collectModelValuesTiered`/`aggregate`: unverändert.
- Hourly: bleibt Single-Point.
- Settings-UI: keine neuen Toggles.

## Quota-/Performance-Impact

- **Open-Meteo Daily:** 1 Call wie bisher, aber 4 Punkte. JSON ~4× grösser (~50 KB statt ~12 KB) — Worker handlet das problemlos.
- **Open-Meteo Hourly:** unverändert.
- **SwissMetNet:** in Phase 2 +1 Station, gecacht — vernachlässigbar.
- **Generation-Latenz:** +200–400 ms durch grösseres JSON-Parsen + minimal grösseren LLM-Prompt. Akzeptabel.
- **LLM-Token-Kosten:** Prompt-Daten ~10–15 % grösser. Im Rahmen.

## Akzeptanzkriterien (alle Wetterlagen)

- Ruhige Hochdrucklage, alle vier Punkte ähnlich: `significant_diffs` leer → keine Zonen-Trennung im Text, einheitliche Aussage über den Perimeter.
- Schauerlage mit isolierter Zelle (Niederschlag 0.5 / 1.2 / 2.1 / 4.3 mm): `significant_diffs: ["precip"]` → Text differenziert beim Niederschlag, nicht aber bei Temperatur/Wind.
- Bisenlage (Wind See 30 / Hinterland 8 km/h): `significant_diffs: ["wind_max"]` → Wind-Aussage differenziert, Temperatur einheitlich.
- Strahlungsnacht (tmin See -1 / Hinterland -5 °C): `significant_diffs: ["tmin"]` → Frostgefahr explizit für Hinterland.
- Föhnlage: bestehender Föhn-Layer + Zonen-Daten ergänzen sich, Text bekommt sowohl qualitative Föhn-Sprache als auch konkrete Zonen-Zahlen.
- Im Text werden nie Rheintal, Steckborn, Frauenfeld, Konstanz, Kreuzlingen, Vaduz/Buchs erwähnt.

## Risiken

- **Open-Meteo Quota-Counting:** unbekannt ob 1 oder 4 Calls intern gezählt. Test-Call hat Verhalten bestätigt, nicht das Counting. Falls real 4× → fallback auf 2 Punkte (See/Hinterland). Im ersten Tag nach Deployment beobachten.
- **CH-Modelle decken Münsterlingen knapp ab** — Open-Meteo fällt sonst auf gröberes Modell zurück. `models_used` pro Zone wird im Datenobjekt protokolliert; falls eine Zone konstant grobes Modell bekommt, Punkt verschieben.
- **LLM könnte Zonen verwechseln/erfinden** — Prompt-Regel "nur diese vier + naheliegende, nichts anderes" muss strikt sein. Nach erstem Live-Test nachschärfen.
- **Mittelwert-Aussagen für Klima/Bodensee bleiben Mittelpunkt-basiert** — kein Bruch der bestehenden Helper, aber konzeptuell minimal inkonsistent (Mittelpunkt vs. Zonen). Akzeptiert für Phase 1.
