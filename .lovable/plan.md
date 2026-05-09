## Diagnose

Beim Forecast `08324cde…` sind die Texte ab Tag 2 (eigentlich erst Tag 3 — Dienstag und Mittwoch) faktisch falsch. Beispiel **Dienstag, 12. Mai**:

| Feld | Wert |
|---|---|
| `precip.avg` | 8 mm (Modelle: 4.7 – 13.9 mm) |
| `precip_prob.avg` | 92 % |
| `weathercode` (alle Modelle) | 61–85 (Regen / Regenschauer) |
| `ensemble.precip_sum.p50` | 6.3 mm, `spread_class: high` |
| `cloudcover.avg` | 59 % |
| `sunshine_h.avg` | **12.2 h** (alle Modelle 11.7 – 13.3) |

Geschriebener Text: *„Am Morgen zunächst stark bewölkt … danach recht sonnig … weiterhin recht sonnig"* — kein Wort über Regen.

Mittwoch (13. Mai) bekommt **wortwörtlich denselben Sky-Block** wie Dienstag, obwohl die Datenlage ganz anders ist (precip 0 mm, prob 28 %).

### Ursachen

1. **Open-Meteo liefert physikalisch widersprüchliche Tageswerte**: für mittel­fristige Modelle (Tag 2+) berichtet `sunshine_duration` 11–13 h, gleichzeitig sagt `precipitation_probability_max` 92 % und `weathercode` Regen. Das ist ein bekanntes Artefakt der Tages­aggregation (Sonne in Schauer­pausen wird voll gezählt).
2. **Der Prompt priorisiert Sonne / Cloudcover gegenüber Niederschlag**: der Bot konstruiert die Sky-Beschreibung aus `cloudcover`/`sunshine_h` und übergeht `precip_prob` + `weathercode`, sobald die Sonne hoch erscheint. Es gibt keine harte Regel „wenn Modelle Regen sagen, MUSS Regen im Text stehen".
3. **Ähnliche Inputs → identischer Output**: Di und Mi haben fast identische `cloudcover` (59 vs 59.7 %) und `sunshine_h` (12 vs 10 h). Da der Prompt Niederschlag ausklammert, generiert das Modell zweimal denselben Satz.

## Vorschlag (3 Hebel, kombinieren)

### A) Daten plausibilisieren (`formatDayData`)
- Wenn `precip_prob.avg ≥ 60` **oder** Mehrheit der `weathercode.by_model ≥ 60`: `sunshine_h` als „unzuverlässig" markieren (Feld `sunshine_h_reliable: false`), zusätzlich `cloudcover` mindestens auf 70 % anheben, falls der Modellwert tiefer ist (Konsistenz mit Niederschlagsdaten).
- Neues server-seitiges Feld `precip_class`: `dry` (≤ 0.2 mm & prob < 30), `showers` (prob ≥ 50 oder 0.5–5 mm), `rain` (≥ 5 mm oder prob ≥ 80), `heavy` (≥ 15 mm).
- Neues Feld `sky_directive`: kompakter, vom Server vorgegebener Sky-Hinweis (z. B. `"bewölkt mit Schauern"`, `"wechselnd bewölkt, Schauer am Nachmittag"`), abgeleitet aus precip_class + cloudcover + Tageszeit-Verteilung. Damit hat der LLM eine harte Vorgabe statt zu raten.

### B) Prompt-Regeln verschärfen (`DEFAULT_SKY_RULES`)
- Neue Top-Regel: **„Niederschlag dominiert immer."** Wenn `precip_class ∈ {showers, rain, heavy}` ODER `precip_prob.avg ≥ 60` ODER Mehrheit der `weathercode.by_model ≥ 60`: der Sky-Satz **MUSS** Niederschlag (Schauer / Regen / Gewitter je nach Klasse) nennen und darf **nicht** mit „sonnig" / „recht sonnig" enden. „Sonnig" nur erlaubt, wenn precip_class = `dry`.
- `sunshine_h` ignorieren, wenn `sunshine_h_reliable: false`.
- Wenn `sky_directive` gesetzt ist, dieses sinngemäss übernehmen, statt eigenständig aus cloudcover/sunshine zu konstruieren.

### C) Variation zwischen ähnlichen Tagen
- `precip_class` als Differenzierungs-Schlüssel an den Prompt mitgeben mit Hinweis: „benachbarte Tage mit unterschiedlicher precip_class müssen unterschiedlich beschrieben werden". Verhindert Copy/Paste-Output Di → Mi.

## Umsetzung (nach Freigabe)

1. `formatDayData`: `precip_class`, `sunshine_h_reliable`, `sky_directive` ableiten.
2. `DEFAULT_SKY_RULES` in `forecast.functions.ts`: Niederschlag-dominiert-Regel + sunshine-fallback einbauen.
3. `enforceSkyConsistency`: harte Nachprüfung — wenn `precip_class ∈ {rain, heavy}` und Wort „sonnig" im Text dominiert ohne Regen-Erwähnung, einen Hinweis-Satz prepend (oder Re-Generation triggern).
4. Optional: Schwellwerte (`precip_prob` ≥ 60, „heavy" ≥ 15 mm) als Settings-Felder.

## Frage an dich

Welche Hebel möchtest du? Empfehlung: **A + B**, das löst beide Probleme (falsche Sky-Beschreibung + Doppelung Di/Mi). C ist nice-to-have als Sicherheits­netz.