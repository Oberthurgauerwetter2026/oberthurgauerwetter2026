## Ziel

Bodensee-Wassertemperatur als **bedingten** Hinweis-Layer integrieren, basierend auf einer **hartcodierten klimatologischen Tabelle** (Monatsmittel) — keine externe API nötig.

Hinweise erscheinen nur bei:
1. **Seerauch-Risiko** (Spätherbst/Winter): kalte Luft über deutlich wärmerem See.
2. **Hitze-Dämpfung am Ufer** (Sommer): See > 22 °C → gedämpfte Nachtabkühlung.
3. **Frühjahrs-Kälte am Ufer**: See < 8 °C → gedämpfte Erwärmung.

Sonst: keine Erwähnung.

## Umsetzung in `src/server/forecast.functions.ts`

### 1. Klima-Lookup
Neue Konstante `BODENSEE_CLIMATOLOGY_C` mit Monatsmitteln (Quelle: IGKB Langzeitmittel Obersee, Oberflächenwasser):

| Monat | Jan | Feb | Mär | Apr | Mai | Jun | Jul | Aug | Sep | Okt | Nov | Dez |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| °C | 5 | 4 | 5 | 8 | 12 | 17 | 20 | 21 | 18 | 14 | 10 | 7 |

Helper `getLakeTempForDate(dateIso: string): number` — lineare Interpolation zwischen Monatsmitten (z. B. 15. eines Monats = exakt Mittelwert, dazwischen interpoliert). Ergebnis auf 1 Dezimalstelle gerundet.

### 2. Helper `formatLakeTemperatureHint(weather, day)`
Returnt String oder `null`. Bedingungen:

- **Seerauch** (Tmin ≤ Wassertemp − 8 °C, Wind ≤ 10 km/h, klare/teilklare Nacht via cloud cover oder weather code):
  → `"Bodensee saisonal ca. ${T}°C, Tmin ${dT}°C tiefer bei schwachem Wind und klarem Himmel: Verdunstungsnebel/Seerauch über dem See möglich, vom Ufer aus sichtbar."`

- **Hitze-Dämpfung** (Wassertemp > 22 °C UND Tmax ≥ 28 °C):
  → `"Bodensee saisonal ca. ${T}°C — am Seeufer gedämpfte Nachtabkühlung, dort lokal mildere Tmin-Werte als landeinwärts."`

- **Frühjahrs-Kälte** (Wassertemp < 8 °C UND Tmax ≥ 18 °C):
  → `"Bodensee noch kalt (saisonal ca. ${T}°C) — am Seeufer gedämpfte Erwärmung, leicht kühlere Tmax als wenige km landeinwärts."`

- Sonst: `null`.

Wichtig: Formulierung **"saisonal ca."** macht klar, dass es ein Klima-Mittel ist, kein Live-Messwert.

### 3. Helper `formatLakeTemperatureTrendHint(weather)`
Für Trend-Block (Tag 6–10): nutzt das Datum **Mitte des Trend-Zeitraums** für die Klima-Lookup. Liefert nur dann String, wenn der Saisonwert ≥ 22 °C oder ≤ 5 °C ist (klare Saison-Extremwerte). Sonst `null`.

### 4. System-Prompt-Erweiterung
Neuer Abschnitt nach AIFS-Block (~Zeile 1356):
```
=== BODENSEE-WASSERTEMPERATUR ===
Wenn im User-Prompt ein Block 'Bodensee-Hinweis' enthalten ist: Übernimm den Hinweis sinngemäss in den Fliesstext (nicht wörtlich kopieren). Erwähne ihn maximal einmal pro Eintrag, dezent und ortsbezogen ("am Seeufer", "über dem See", "in Seenähe"). Niemals erfinden — nur nennen, wenn der Block explizit vorhanden ist. Die Wassertemperatur ist ein klimatologischer Saisonwert, nicht ein aktueller Messwert — formuliere entsprechend ("rund", "saisonal", "typischerweise").
```

### 5. Prompt-Injection
In `generateForecast` und `regenerateForecast` parallel zu den AIFS-Blöcken:
```ts
const lakeHint = formatLakeTemperatureHint(weather, day);
const lakeBlock = lakeHint ? `\n\nBodensee-Hinweis: ${lakeHint}` : "";
```
Analog für Trend-Block.

## Was nicht geändert wird

- Keine externe API, kein Cache, keine DB-Migration, kein Settings-UI.
- Multi-Modell-Mittelwert, AIFS, Topografie, Güttingen-Bias, MOSMIX, Radar bleiben unverändert.

## Akzeptanzkriterien

- Sommer-Normaltag (Juli, Tmax 24 °C, Tmin 13 °C): kein Hinweis (Hitze-Schwelle nicht erreicht).
- November-Strahlungstag (Tmin 1 °C, Wind 5 km/h, klar): Klima-See ~10 °C → 9 °C Differenz → Seerauch-Hinweis erscheint.
- Hitzetag (Juli, Tmax 32 °C): Klima-See 20 °C → knapp unter Schwelle, kein Hinweis. August-Hitzetag (Tmax 32 °C): See 21 °C → knapp unter 22 °C, kein Hinweis. **Anpassung**: Schwelle auf > 20 °C senken, damit Sommer-Hitzetage sicher den Hinweis triggern.
- April-Föhntag (Tmax 22 °C): Klima-See 8 °C → Frühjahrs-Hinweis erscheint.

## Risiken

- **Klima-Mittel kann in Realität ±3 °C abweichen** (kalter Frühling, warmer Herbst). Da wir nur Schwellenwerte nutzen und die Formulierung "saisonal ca." vorgibt, ist das akzeptabel — der Hinweis bleibt qualitativ korrekt, nur das Risiko falsch-negativer/positiver Trigger steigt leicht.
- Später nachrüstbar: sobald eine Live-API verfügbar wird, kann `getLakeTempForDate` durch einen API-Call ersetzt werden, ohne dass die Konsumenten-Logik (`formatLakeTemperatureHint` etc.) geändert werden muss.