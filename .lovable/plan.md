# Quellwolken-Erkennung (Cumulus) im Tagestext

Ergänzt eine eigene Klassifikation für Quellbewölkung, getrennt vom bestehenden Gewitter-Hinweis. Erscheint als eigener Satz im Tagestext (z. B. „nachmittags Bildung harmloser Quellwolken").

## Datengrundlage (alles bereits vorhanden)

In `src/server/forecast.functions.ts` werden bereits abgefragt:
- `cape_max` (daily) und `cape` (hourly) — Z. 122 / 127
- `cloudcover_low` (hourly) — Z. 129
- `sunshine_duration` (daily/hourly) — Z. 119 / 127
- Hourly-Tagesfenster-Logik existiert in `formatThunderstormHint` (Z. 904 ff.)

Keine Erweiterung der Open-Meteo-Abfrage nötig.

## Klassifikationslogik

Neue Funktion `formatCumulusHint(weather, day): string | null` mit Tagesgang-Auswertung (Vormittag / Nachmittag / Abend, analog `formatThunderstormHint`):

Pro Fenster gemittelt über Modelle:
- `capeAvg` (aus stündlichen `cape_*`-Keys)
- `cloudLowAvg` (aus stündlichen `cloudcover_low_*`-Keys)
- `sunshineDay` aus daily `sunshine_h`

Klassen (Bedingungen müssen alle im jeweiligen Fenster erfüllt sein):

| Klasse | CAPE | Cloudcover-Low | Sonne (Tag) | Output-Bezeichnung |
|---|---|---|---|---|
| Schönwetter-Cumulus | 50–300 | 10–40 % | ≥ 5 h | „harmlose Quellwolken" |
| Cumulus mediocris | 100–500 | 25–60 % | ≥ 4 h | „kräftigere Quellbewölkung" |
| Cumulus congestus | 300–800 | 30–70 % | ≥ 3 h | „mächtige Quellwolken, einzelne Schauer möglich" |

Abbruchbedingungen (Funktion gibt `null` zurück):
- CAPE ≥ 800 ODER Gewitter-Trigger aktiv → bestehender Gewitter-Hinweis übernimmt
- Cloudcover-Low > 80 % im Hauptfenster → bedeckt, keine erkennbaren Einzelquellen
- Kein Fenster erfüllt eine Klasse → kein Satz

Output-Beispiele:
- „Am Nachmittag Bildung harmloser Quellwolken."
- „Tagsüber kräftigere Quellbewölkung, am Nachmittag mächtige Quellwolken mit einzelnen Schauern möglich."

## Integration in Tagestext

Analog zum bestehenden `stormBlock` an 4 Stellen (Z. 2099, 2126, 2267, 2294):

```ts
const cumulusHint = formatCumulusHint(weather, day);
const cumulusBlock = cumulusHint ? `\n\nQuellwolken: ${cumulusHint}` : "";
```

Reihenfolge im Prompt: erst `cumulusBlock`, dann `stormBlock` (Quellwolken sind die Vorstufe — ergibt natürliche Lesefolge). Beide schliessen sich faktisch aus, da Cumulus-Funktion bei CAPE ≥ 800 / Gewitter-Trigger `null` liefert.

## System-Prompt-Ergänzung

Im Senken-/Vokabular-Block kurzer Hinweis: Wenn `Quellwolken: …` im Datenblock steht, soll der Tagestext den Hinweis sinngemäss übernehmen (nicht 1:1 kopieren), aber Begriffe wie „Quellwolken / Quellbewölkung / Cumulus" verwenden — keine generischen Phrasen wie „Wolken bilden sich".

## Geänderte Datei

- `src/server/forecast.functions.ts` — neue Funktion `formatCumulusHint` (~60 Zeilen), 4 Integrationspunkte, kleine Prompt-Ergänzung
