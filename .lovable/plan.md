
## Befund: Ja, Tag 0–5 ist inkonsistent

Nach den letzten Fixes ist die Korruption weg, aber der Weg vom Wettermodell zum Eintrag verläuft pro Tag unterschiedlich. Das macht es schwer vorherzusagen, **welche** Modelle, **welche** Gewichtung und **welches** Zeitfenster pro Tag tatsächlich landen.

### Konkrete Brüche

| Tag | Daily-Aggregation | MOSMIX-Mix | Hourly-Profil / Distribution | Refine ab Stunde |
|---|---|---|---|---|
| 0 | `formatDayData` → `collectModelValuesTiered` (Tier-Fallback) | **nein** (obwohl `tag0_weight_*` Settings existieren) | ja | – |
| 1 | `formatDayData` **dann** `refineDayFromHour(…, 6)` überschreibt tmin/tmax/precip/cloud/sunshine über eine **andere** Aggregation (nur `hourly[base_<model>]`, **kein** Tier-Fallback) | **nein** (obwohl `tag1_weight_*` Settings existieren) | ja, ein zweites Mal in Refine berechnet | 6 |
| 2 | `formatDayData` (mid + Tier-Fallback) | ja, `tag2_weight_*` (25/75) | ja | – |
| 3 | `formatDayData` | ja, `tag3plus_weight_*` (45/55) | ja | – |
| 4 | `formatDayData` | ja, `tag3plus_weight_*` | ja | – |
| 5 | `formatDayData` | ja, `tag3plus_weight_*` | **nein** (`dayIndex <= 4`-Cutoff) | – |

Daraus folgen die Probleme, die du im Output siehst:

1. **Tag 1 vs. Tag 0/2–5 nutzen unterschiedliche Aggregations-Pfade.** `refineDayFromHour` mischt nur Modelle, die im Hourly-Block stehen, ohne Tier-Fallback. ICON-CH1 ist ab ca. h+33 raus — `formatDayData` würde dann automatisch CH2/AROME nachziehen, `refineDayFromHour` nicht. Folge: Tag 1 nachmittags hängt am dünnsten Modell-Set des ganzen Wochenausblicks.
2. **`tag0_weight_*` / `tag1_weight_*` Settings sind tot.** Code mischt MOSMIX nur ab Tag 2. UI verspricht etwas anderes.
3. **`models_used` und `tier` lügen für Tag 1.** `refineDayFromHour` macht `{ …day }` und überschreibt nur Werte, nicht die Diagnose. Im UI steht "tier: short, models_used: …", obwohl die finalen Zahlen aus einem anderen Modell-Mix stammen.
4. **Lücke zwischen "Heute Abend & Nacht" und Tag 1.** `refineDayFromHour(…, 6)` schneidet **immer** 00–06 von Tag 1 weg — auch dann, wenn der erste Eintrag "Heute, Vormittag" oder "Heute Nachmittag & Abend" heisst und die Vornacht von Tag 1 gar nicht abdeckt. Saubere Annahme nur, wenn Erst-Eintrag = "Heute Abend & Nacht".
5. **Tag 5 hat plötzlich keinen Tagesgang/Wolkenschichten** (`dayIndex <= 4`-Cutoff in `formatDayData`), Tag 4 schon → sichtbare Bruchkante in der Beschreibung.
6. **`formatDayData` und `refineDayFromHour` definieren `collectArrs` noch parallel** (zwei nahezu identische Closures, gleicher Bug-Vektor). Nach dem Whitelist-Fix sind sie korrekt, aber drift-anfällig.

### Plan

#### Baustein 1 — Refine-Fenster an den ersten Eintrag koppeln
`refineDayFromHour` für Tag 1 nur dann mit `fromHour=6` aufrufen, wenn der Erst-Eintrag tatsächlich die Vornacht abdeckt (Titel = "Heute Abend & Nacht"). Sonst `fromHour=0` (= ganzer Tag, keine künstliche Lücke). Der Aufrufer (`buildDay`) bekommt dafür ein Argument `firstEntryCoversNight: boolean`, das aus `restOfDayTitle(startHour, …) === "Heute Abend & Nacht"` abgeleitet wird. Beide Aufrufstellen (Z. 2989 und Z. 3180) ziehen am selben Helper.

#### Baustein 2 — Tier-Fallback in `refineDayFromHour`
Wenn nach dem Window <2 Modelle in `precPerModel` / `cloudPerModel` / `sunHPerModel` übrig sind, mit Werten aus `formatDayData` (also `day.precip.by_model` etc.) auffüllen, **bevor** `aggregate`/`weightedCloudSunAvg` läuft. Das ersetzt das bisherige `console.warn` (Diagnose bleibt drin) durch ein echtes Fallback und macht Tag 1 nachmittags wieder belastbar, wenn ICON-CH1 expired.

#### Baustein 3 — `tag0_weight_*` / `tag1_weight_*` aktivieren oder entfernen
Eine von zwei Optionen — bitte entscheiden:
- **a)** MOSMIX-Mix für Tag 0 + 1 mit den existierenden Settings aktivieren (Default 0/100, also faktisch aus, aber nutzbar).
- **b)** Settings + Spalten + UI-Felder entfernen, Doku klar sagen "MOSMIX erst ab Tag 2".

Empfehlung: **a)** — minimaler Eingriff, behebt die Lüge zwischen UI und Code, Default-Verhalten bleibt unverändert.

#### Baustein 4 — Tag 5 bekommt Tagesgang
`computePrecipDistribution`, `buildHourlyProfile`, `computeCloudSunDistribution`, `computeCloudLayers` von `dayIndex <= 4` auf `dayIndex <= 5` heben. Open-Meteo Hourly liefert für die mid-Tier-Modelle bis ~5 Tage; falls Datenlage dünn, fällt das Ergebnis automatisch leer aus — kein Risiko, nur ein Gewinn an Konsistenz.

#### Baustein 5 — Diagnose-Felder im Refine aktualisieren
In `refineDayFromHour` nach dem Mix `out.models_used` neu berechnen (Vereinigung der `by_model`-Keys aus den überschriebenen Feldern) und `out.refined_window = { from_hour: fromHour, to_hour: 24 }` ergänzen. `tier` bleibt aus `formatDayData` (kommt vom `pickBestSource`-Setup). Damit steht im UI/Prompt, was wirklich verwendet wurde.

#### Baustein 6 — `collectArrs` als gemeinsamer Helper
Aktuell vier nahezu identische Closures. Einmaliger Helper `makeCollectArrs(weather)` (analog zu `getKnownModels`) am Modul-Level, alle vier Stellen importieren ihn. Kein Verhaltensänderung, nur eine Quelle der Wahrheit für künftige Änderungen am Whitelist-Pattern.

### Reihenfolge & Scope
- Bausteine 1, 2, 5 sind die mit dem grössten Effekt auf den AI-Text (Tag 1 wird stabil, Vornacht-Lücke weg, Diagnose ehrlich).
- Baustein 4 ist ein kleiner, in sich abgeschlossener Konsistenz-Fix.
- Baustein 6 ist Hygiene, kein Verhalten.
- Baustein 3 ist eine Produkt-Entscheidung — ich brauche dein OK auf a) oder b).

Nicht im Scope: AI-Prompt-Anpassungen, Gewichtsverteilung in `CLOUD_SUN_WEIGHTS` / `PRECIP_HOURLY_WEIGHTS`, neue Modelle. Erst sehen, ob die Pipeline nach diesen sechs Schritten konsistent läuft.

### Verifikation
- Typecheck.
- Nach nächster Generierung pro Tag in `weather_data` prüfen:
  - `models_used` ist nicht leer und enthält ICON-Modelle.
  - `precip.by_model` enthält nur echte Modell-IDs (kein `probability_*`, `low_*`, …).
  - Tag 5 hat `precip_distribution` und `hourly_profile`.
  - Tag 1 bei Erst-Eintrag ≠ "Heute Abend & Nacht": `refined_window.from_hour = 0`.

### Frage vor der Umsetzung
Baustein 3: **a) Tag 0/1-MOSMIX-Mix aktivieren** oder **b) tote Settings entfernen**?
