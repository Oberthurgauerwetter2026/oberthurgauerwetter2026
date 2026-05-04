## Ziel

Gewitter-Erkennung und -Stärke realistisch in den Prompt bringen — über CAPE als Convective-Indicator und Tagesgang aus den Hourly-Daten. Bedingter Layer wie AIFS und Bodensee: erscheint nur wenn relevant.

Verifiziert per Test-Call: Open-Meteo liefert sowohl `cape` (hourly) als auch `cape_max` (daily) für **alle** verwendeten Modelle (auch die Schweizer) zurück. Keine zusätzlichen Requests, kein Quota-Impact.

## Umsetzung in `src/server/forecast.functions.ts`

### 1. Variablen erweitern
- `DAILY_VARS`: zusätzlich `cape_max` (J/kg, Tagesmaximum)
- `HOURLY_VARS`: zusätzlich `cape`

### 2. Aggregation
In `formatDayData` (~Zeile 1024):
```ts
const cape_max = aggregate(collectModelValuesTiered(weather, "cape_max", dayIndex));
```
in das Tagesobjekt aufnehmen (`cape_max`). Aggregation als Mittelwert ist hier sinnvoll, da CAPE eine kontinuierliche Grösse ist.

### 3. Helper `formatThunderstormHint(weather, day, dayIndex)`
Neu, nach den AIFS/Bodensee-Helpern. Returnt String oder `null`. Logik:

**Trigger:** Hinweis nur wenn mindestens eines erfüllt:
- `day.cape_max?.avg` ≥ 500 J/kg
- weathercode eines Modells in `[95, 96, 99]` (Gewitter) oder `[80, 81, 82]` (Schauer) bei gleichzeitig `cape_max ≥ 300` oder `precip ≥ 2 mm`

**Stärke-Stufen (basierend auf max CAPE über Modelle):**
| CAPE max | Label |
|---|---|
| 300–800 | "Gewitterneigung, einzelne lokale Schauer/Gewitter möglich" |
| 800–1500 | "Gewitter wahrscheinlich, lokal kräftig mit Starkregen und Sturmböen" |
| 1500–2500 | "kräftige Gewitter wahrscheinlich, Risiko für Hagel und Sturmböen" |
| > 2500 | "schwere Gewitterlage, lokal erhöhtes Risiko für grossen Hagel, Sturmböen, intensiven Starkregen" |

**Tagesgang (nur Tag 0–1, wenn Hourly-Daten vorhanden):**
- Aus `weather.hourly.cape_*` und `weather.hourly.weathercode_*` für den Tag drei Zeitfenster bilden: 06–12 (Vormittag), 12–18 (Nachmittag), 18–24 (Abend).
- Pro Fenster: max CAPE (Mittel über Modelle), max weathercode-Gewitter-Vote.
- Hinweis-Format: `"Gewitterrisiko vor allem ${zeitfenster}"` — wo zeitfenster = "am Nachmittag", "am Abend", "von Mittag bis in den Abend", etc.
- Wenn alle Fenster ähnliches CAPE haben (Diff < 30 %): kein Tagesgang-Zusatz.

**Beispiel-Outputs:**
- Tag 1, CAPE 1200, Maximum nachmittags: `"Konvektiv labile Lage (CAPE ca. 1200 J/kg) — kräftige Gewitter wahrscheinlich, lokal mit Starkregen und Sturmböen, Schwerpunkt am Nachmittag und frühen Abend."`
- Tag 4, CAPE 600: `"Konvektiv leicht labile Lage — Gewitterneigung, einzelne lokale Schauer und Gewitter möglich."`
- Tag 6, CAPE 200, Sommer: `null` (kein Hinweis).

### 4. System-Prompt-Erweiterung
Neuer Abschnitt nach BODENSEE-Block (~Zeile 1448):
```
=== GEWITTER-HINWEIS ===
Wenn im User-Prompt ein Block 'Gewitter-Hinweis' enthalten ist: Übernimm die Stärke- und Tagesgang-Aussage sinngemäss in den Fliesstext (nicht wörtlich kopieren). Verwende die Pflicht-Vokabular-Begriffe ("Schaueraktivität", "in Begleitung von Gewitter", "kräftige Böen", "Starkregen"). Bei kräftigen/schweren Gewitterlagen klar benennen ("kräftige Gewitter wahrscheinlich", "Hagel- und Sturmböenrisiko"). CAPE-Werte selbst NICHT nennen — nur die qualitative Aussage. Wenn kein Block vorhanden ist, KEINE Gewitter-Aussagen über das hinaus, was Niederschlag und weathercode bereits hergeben.
```

### 5. Prompt-Injection
An allen 6 bestehenden Stellen (parallel zu `aifsBlock` und `lakeBlock`):
```ts
const stormHint = formatThunderstormHint(weather, day, dayIndex);
const stormBlock = stormHint ? `\n\nGewitter-Hinweis: ${stormHint}` : "";
```
Dann in den `userPrompt`-Template-String anhängen.

Für den Trend-Block (Tag 6–10): einfacher — schaut über die Trend-Tage, ob mindestens ein Tag CAPE ≥ 800 hat, dann kompakter Hinweis "im Trend-Zeitraum zeitweise erhöhte Gewitterneigung". Sonst `null`.

## Was nicht geändert wird

- weathercode-Aggregation (Mittelwert) bleibt — der neue Helper kompensiert die Glättung über CAPE und Per-Modell-Code-Vote, ohne den bestehenden Datenfluss zu brechen.
- Multi-Modell-Mittelwert, AIFS, Bodensee, Topografie, Güttingen-Bias, MOSMIX, Radar, Settings-UI: unverändert.
- Keine DB-Migration, kein Schema-Change, kein Settings-Toggle.

## Quota-/Performance-Impact

- **0 zusätzliche externe Requests**. CAPE-Variablen werden in den bestehenden Multi-Modell-Calls mitgeliefert.
- Antwort wird minimal grösser (~10 % mehr JSON pro Call, vernachlässigbar).
- Bei Modellen die CAPE nicht liefern: `null` in `by_model`, wird im `aggregate()` einfach ignoriert — fail-soft.

## Akzeptanzkriterien

- Stabiler Hochdrucktag (CAPE 50, Sonne): kein Gewitter-Hinweis.
- Sommer-Tag mit isolierten Wärmegewittern (CAPE 1200, weathercode 95 bei einem Modell, Hourly-Maximum nachmittags): Hinweis "kräftige Gewitter wahrscheinlich, Schwerpunkt am Nachmittag".
- Frontdurchgang mit grossräumigem Niederschlag und Gewitter (CAPE 800, weathercode 95 bei mehreren Modellen): Hinweis "Gewitter wahrscheinlich, lokal kräftig".
- Schwere Lage (CAPE 2800): Hinweis "schwere Gewitterlage, Hagel- und Sturmböenrisiko".
- Tag 5+ ohne Hourly: nur tageszeitloser Stärke-Hinweis, kein erfundener Tagesgang.

## Risiken

- **CAPE allein ist nicht ausreichend** für eine echte Gewittervorhersage (es fehlen Lifted Index, Cap, Wind-Shear). Für eine Allwetter-Konsumenten-Prognose ist CAPE + weathercode-Vote aber ein klarer Sprung gegenüber dem Status quo.
- **Falsch-positive Hinweise** an stabilen Tagen mit hohem CAPE aber starkem Cap (z. B. Föhnlagen): durch Kombination CAPE ≥ 500 **und** Niederschlagssignal/weathercode reduziert, aber nicht eliminiert. Bei Beobachtung nachjustierbar (Schwellenwerte sind Konstanten im Helper).
- **Glättung über Modelle** kann starke konvektive Signale eines Modells (z. B. ICON-CH1) durch ruhigere Modelle (IFS) verwässern. Daher der **Per-Modell-weathercode-Vote**: wenn ≥1 Modell explizit Gewitter sieht und CAPE den Energiekontext bestätigt, wird's gemeldet.