## Befund

`enforceSkyConsistency` ersetzt aktuell den ersten Absatz der KI-Ausgabe immer dann, wenn `buildDeterministicSkyParagraph` einen Text liefert. Diese Funktion baut einen reinen Sky-Text **ohne jeden Niederschlagsbezug** und triggert auch auf Tagen mit signifikantem Regen, sobald entweder

- `sunshine_h.avg ≥ 9` ODER
- 7+ Stunden mit `s ≥ 30` im stündlichen Profil ODER
- Nebelmehrheit / Nebelauflösung erkannt wird.

Folge: Auf Tagen wie Montag (16 mm Niederschlag, aber laut Profil 5 sonnige Stunden am Nachmittag) oder Dienstag (8 mm in Nacht/Vormittag) überschreibt die Vorlage den korrekten KI-Text durch das immer gleiche „Am Morgen zunächst stark bewölkt … rasche Auflösung, danach recht sonnig …" — der Niederschlag verschwindet komplett aus dem Body.

Verstärkt wurde das Problem durch den vorherigen Prefix-Bug-Fix: das stündliche Profil ist jetzt sauberer, dadurch zählen mehr Tage als „verySunny" oder „fogMorning" und triggern den Override.

## Änderung (nur `src/server/forecast.functions.ts`)

### 1. Sky-Override an Niederschlag knüpfen

In `enforceSkyConsistency` (Z. 275) eine Vorabprüfung einbauen: wenn der Tag nennenswerten Niederschlag hat, KEINE Überschreibung des ersten Absatzes mehr vornehmen.

Kriterium „Regentag" (eines genügt):
- `weatherData.precip?.avg ≥ 1` mm, ODER
- `weatherData.precip_distribution?.peak_block` ist gesetzt (≥ 1 mm in einem Block), ODER
- `precip_distribution.overall_max_prob ≥ 60` UND irgendein Block hat `precip_mm ≥ 0.5`.

Bei einem Regentag:
- `buildDeterministicSkyParagraph` NICHT anwenden,
- `isClearSkyDay` (Cloud ≤ 5 % UND Sonne ≥ 10 h) bleibt zwar formal möglich, ist aber bei Regen ohnehin nie wahr → kein Konflikt,
- `enforceFogWording` weiterhin laufen lassen (rein lexikalische Korrektur, harmlos).

### 2. Sky-Template defensiver

In `buildDeterministicSkyParagraph` (Z. 226):
- `verySunny`-Schwelle anheben: `sunnyHours ≥ 8` statt `≥ 7`, `sunshineAvg ≥ 10` statt `≥ 9` — damit das Template nur bei tatsächlich sehr sonnigen Tagen greift.
- Zusätzliche Sicherung: wenn `weatherData.precip?.avg ≥ 1` mm, sofort `null` zurückgeben (Defense-in-Depth, falls Aufrufer den Override-Schutz vergisst).

### 3. Prompt-Regel nachschärfen

Im System-Prompt-Block für die Tagesbeschreibung ergänzen:
- „Bei `precip.avg ≥ 1 mm` MUSS der erste Absatz die Niederschlagsphase explizit benennen (z. B. ‚am Vormittag zeitweise Regen, am Nachmittag Auflockerungen, am Abend erneut Schauer'). Sky-Beschreibung und Niederschlag dürfen NICHT in getrennten Absätzen stehen, wenn der Niederschlag tagesprägend ist."

Damit liefert die KI von Anfang an einen integrierten Wetter-Absatz und der Override-Eingriff ist auch konzeptionell überflüssig.

### 4. Diagnose-Log

In `enforceSkyConsistency`: wenn der Override aktiv wäre (deterministicSky ≠ null), aber wegen Regen unterdrückt wird, einmal `console.log("[sky-override] suppressed due to precip", { date, precipAvg, peakBlock })`. Hilft, die Wirkung zu verifizieren.

## Was wir nicht anfassen

- `computePrecipDistribution`, Hourly-Fallback, Mid-/Short-Tier-Logik (vorheriger Fix bleibt).
- Wetterbesserung/-verschlechterung-Prompt-Regeln (bleiben aktiv und passen zur neuen integrierten Sky-Formulierung).
- UI / DB / Bias / Ensemble.

## Validierung

1. Forecast `3254e7fd-…` neu generieren.
2. **Tag 0 (heute):** klar oder leicht bewölkt → Sky-Override darf greifen (kein Niederschlag).
3. **Montag (16 mm):** Body muss Regen morgens UND abends benennen, mit ggf. sonniger Phase am Nachmittag — KEIN reines „rasche Auflösung, danach recht sonnig".
4. **Dienstag (8 mm, peak night/morning):** Body muss „in der Nacht/am Vormittag noch Regen, im Tagesverlauf Wetterbesserung" enthalten.
5. Im Server-Log einen `[sky-override] suppressed due to precip`-Eintrag für Mo/Di sehen.

## Risiken

- Sehr leichter Niesel (`precip.avg` knapp ≥ 1 mm) deaktiviert das Sky-Template auch dann, wenn der Tag faktisch sonnig ist. Mitigiert durch zusätzliche Bedingung `peak_block ≠ null` ODER hohe Wahrscheinlichkeit; reine 1 mm Tagessumme ohne Block-Peak gilt nicht als Regentag.
- Die KI kann auf wirklich klaren Tagen ohne Override eine schlechtere Sky-Formulierung liefern. Die geltenden Sky-Prompt-Regeln bleiben aber unverändert.
