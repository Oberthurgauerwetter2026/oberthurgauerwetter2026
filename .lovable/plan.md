## Ziel

Bodensee-Wassertemperatur (Station Romanshorn 2032) als **bedingten** Layer integrieren — nicht in jeden Prompt schreiben, sondern nur dann, wenn sie wettertechnisch wirklich relevant wird:

1. **Seerauch / Verdunstungsnebel** (vor allem Spätherbst/Winter): kalte Luft über deutlich wärmerem See → Hinweis im Prompt.
2. **Hitze-Dämpfung am Ufer** (Sommer): See deutlich erwärmt → Nachtabkühlung am Ufer schwächer.

Sonst wird die Wassertemperatur nicht erwähnt — kein Lärm, kein Overload.

## Datenquelle

**api.existenz.ch** (freier Proxy auf BAFU-Hydrodaten):
- Endpoint: `https://api.existenz.ch/apiv1/hydro/latest?locations=2032&parameters=temperature&format=json`
- Station 2032 = Bodensee Obersee, Romanshorn (Oberflächenwasser)
- Liefert aktuelle Wassertemperatur in °C
- Update-Intervall ca. 10–30 min, für unseren Zweck reicht **24 h Cache**
- Kein API-Key nötig, freie Nutzung für nicht-kommerzielle Zwecke (passt)

Fail-soft: bei Ausfall liefert der Helper `null`, der Bodensee-Block entfällt komplett — keine Auswirkung auf die Generierung.

## Umsetzung in `src/server/forecast.functions.ts`

### 1. Helper `fetchLakeTemperature`
Neue Funktion, holt Wassertemperatur von existenz.ch, cacht 24 h via `getOrSetCache` mit Key `bafu:lake:2032`. Returnt `{ value: number, timestamp: string } | null`. Fail-soft, alle Fehler → `null`.

### 2. Integration in `fetchWeather`
Sequentieller Call **nach** AIFS (analoges Pattern, fail-soft). Ergebnis landet in `weather.lakeTemp`. Nicht in `byModel`, da es kein Wettermodell ist.

### 3. Helper `formatLakeTemperatureHint(weather, day)`
Neue Funktion, die pro Tag prüft, ob ein Hinweis ausgegeben werden soll. **Returnt nur bei Bedingungserfüllung einen String, sonst `null`**:

- **Seerauch-Bedingung** (Tmin der Nacht ≤ Wassertemperatur −8 °C UND Wind ≤ 10 km/h UND klare/teilklare Nacht):
  → `"Bodensee-Wassertemperatur ${T}°C — Tmin ${dT}°C kälter, schwacher Wind, klar bis teilklar: Verdunstungsnebel/Seerauch über dem See möglich, vom Ufer aus sichtbar."`

- **Hitze-Dämpfung** (Wassertemperatur > 22 °C UND Tmax ≥ 28 °C):
  → `"Bodensee deutlich erwärmt (${T}°C) — Nachtabkühlung am Seeufer gedämpft, dort lokal mildere Tmin-Werte als landeinwärts."`

- **Frühjahrs-Kälte** (Wassertemperatur < 8 °C UND Tmax am Ufer ≥ 18 °C):
  → `"Bodensee noch kalt (${T}°C) — am Seeufer gedämpfte Erwärmung, leicht kühlere Tmax als wenige km landeinwärts."`

- Sonst: `null` (kein Hinweis).

### 4. Helper `formatLakeTemperatureTrendHint(weather)`
Für den Trend-Block (Tag 6–10): liefert nur dann einen kurzen Tendenz-Hinweis, wenn die Wassertemperatur in einem **klimatologisch auffälligen Bereich** ist (z. B. November mit > 12 °C → "ungewöhnlich warmer See, Seerauch-Risiko bei Kaltluftvorstössen"). Konservativ — nur wenn klar relevant.

Erste Iteration: **simpel halten** — gibt die aktuelle Wassertemperatur einmalig im Trend-Block aus, wenn sie ≥ 22 °C oder ≤ 5 °C ist (Saison-Extremwerte). Sonst `null`.

### 5. System-Prompt-Erweiterung (~Zeile 1356, nach AIFS-Block)

Neuer Abschnitt:
```
=== BODENSEE-WASSERTEMPERATUR ===
Wenn im User-Prompt ein Block 'Bodensee-Hinweis' enthalten ist: Übernimm den Hinweis sinngemäss in den Fliesstext (nicht wörtlich kopieren). Erwähne ihn maximal einmal pro Eintrag, dezent und ortsbezogen ("am Seeufer", "über dem See", "in Seenähe"). Niemals erfinden — nur nennen, wenn der Block explizit vorhanden ist. Wenn kein Block vorhanden ist, KEINE Aussagen zur Wassertemperatur machen.
```

### 6. Prompt-Injection
In `generateForecast` und `regenerateForecast` parallel zu den AIFS-Blöcken (Zeilen 1474–1476, 1491–1493, 1503–1505 sowie 1607–1609, 1624–1626, 1636–1638):

```ts
const lakeHint = formatLakeTemperatureHint(weather, day);
const lakeBlock = lakeHint ? `\n\nBodensee-Hinweis: ${lakeHint}` : "";
```

Für den Trend-Block analog `formatLakeTemperatureTrendHint`.

## Was nicht geändert wird

- Multi-Modell-Mittelwert, AIFS-Vergleich, Topografie (`applyTopography`), Güttingen-Bias, MOSMIX, Radar, Settings-UI — alles bleibt unverändert.
- **Keine** Settings-Option (analog AIFS: läuft im Hintergrund, ist bedingt sichtbar). Kann bei Bedarf später nachgerüstet werden.
- **Keine** DB-Migration, kein Schema-Change, keine RLS-Anpassung.

## Quota-/Performance-Impact

- **+1 externer Call pro Generierung**, aber 24 h gecacht → in der Praxis 1 Call pro Tag.
- existenz.ch hat keine harten Limits, ist aber als "fair use" markiert. Mit 24 h-Cache absolut unkritisch.
- Bei Ausfall: `null`, kein Effekt auf die Prognose.

## Risiken

- **existenz.ch könnte ausfallen**: fail-soft eingebaut, kein Generierungsfehler.
- **Schwellenwerte könnten zu konservativ/zu liberal sein**: in der Beobachtung nachjustierbar (alle Schwellen sind Konstanten in den Helper-Funktionen, kein Code-Refactor nötig).
- **Doppelnennung mit Güttingen-Bias möglich**: Güttingen liefert `corrected_tmin/tmax` für den Ufer-Punkt, der Bodensee-Hinweis adressiert separat das *Wasser/Nebel-Verhalten*. Kein Konflikt — anderer inhaltlicher Fokus.

## Akzeptanzkriterien

- An einem normalen Sommertag (Wasser 18 °C, Tmax 24 °C, Tmin 13 °C): **kein** Bodensee-Hinweis im Prompt.
- An einem typischen November-Strahlungstag (Wasser 11 °C, Tmin 1 °C, Wind 5 km/h, klar): Seerauch-Hinweis erscheint.
- An einem Hitzetag (Wasser 23 °C, Tmax 32 °C): Hitze-Dämpfung-Hinweis erscheint.
- Bei Ausfall der existenz.ch-API: Generierung läuft normal weiter, einfach ohne Hinweis.