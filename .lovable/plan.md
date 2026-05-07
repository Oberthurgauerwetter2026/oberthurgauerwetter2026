## Problem

Der Nebel-Auflösungs-Detektor (`detectFogDissipation`) hat den Freitag NICHT erkannt, obwohl alle Indizien vorliegen:

| Stunde | Cloud % | Sonne min | Hinweis |
|---|---|---|---|
| 06 | 94 | 0 | Nebel |
| 07 | 96 | 0 | Nebel |
| 08 | 86 | 55 | Auflösung beginnt |
| 09 | 89 | 60 | weiter aufgelöst |
| 10 | 84 | 60 | |
| 11 | 54 | 60 | klar |

Plus: ICON-D2 liefert weathercode **45 (Nebel)**.

**Ursache:** Die aktuelle Bedingung verlangt für das ganze Fenster 06–10 Uhr `morningSun ≤ 10 min` UND `morningCloud ≥ 80 %`. Da die Auflösung schon um 08 Uhr einsetzt, mittelt sich der Sonnenwert auf ~35 min und die Bedingung schlägt fehl.

Folge: `sky_pattern` bleibt `null`, die KI fällt auf das Tagesmittel (`sunshine_h.avg = 11.9 h`, `cloudcover.avg = 64.5 %`) zurück und erzeugt die generische Aussage „Am Morgen stark bewölkt, im Tagesverlauf Auflockerungen".

## Lösung

Detektor in `detectFogDissipation` (src/server/forecast.functions.ts ~Zeile 1022) lockern und um einen zweiten, schnelleren Trigger ergänzen:

### Anpassung 1 — Frühmorgenfenster verkleinern
Statt 06–10 Uhr nur **06–08 Uhr** als „Morgen" für den Nebel-Check verwenden. So zählt eine frühe Auflösung um 08 Uhr nicht gegen die Bedingung.

### Anpassung 2 — zusätzlicher „Nebelcode-Trigger"
Wenn **mindestens ein Modell weathercode 45 oder 48** liefert UND in den ersten zwei Tagstunden (06/07) `cloud ≥ 85 %` mit `sunshine ≤ 10 min` herrscht, gilt das Muster IMMER als erkannt — unabhängig vom Nachmittagswert (denn Nebel löst sich praktisch immer im Tagesverlauf auf, und der Stundenprofil bestätigt das hier ohnehin).

### Anpassung 3 — Auflösungsstunde-Suche erweitern
Auflösungsstunde-Schleife jetzt von **08 bis 14 Uhr** (statt 09–14), da die Auflösung im obigen Fall um 08 Uhr beginnt.

### Anpassung 4 — Schwelle „Nachmittagsklarheit" entschärfen
Wenn `hasFogCode === true`, reicht `afternoonCloud ≤ 70 %` ODER `afternoonSun ≥ 20 min` (statt 55 % / 30 min). Hochnebelreste am Nachmittag sind realistisch und sollen das Pattern nicht blockieren.

## Resultat für Freitag

`sky_pattern` wird auf `"nebel_aufloesung"` gesetzt → die bereits implementierte Sky-Regel zwingt die KI, den Verlauf „Nebel-/Hochnebelfelder am Morgen, Auflösung im Tagesverlauf, am Nachmittag verbreitet sonnig" zu schreiben.

## Was nicht geändert wird

- Sky-Regeln im Prompt (bereits korrekt formuliert).
- Andere Tage ohne Nebelmuster bleiben unbeeinflusst (Trigger benötigt entweder Nebel-Code oder eindeutigen Cloud/Sonnen-Kontrast).
- Aggregation, Datenbank, UI: unverändert.

## Datei

- `src/server/forecast.functions.ts`, Funktion `detectFogDissipation` (~Z. 1022–1064)