## Problem

Im aktuellen Forecast (Mittwoch, 13. Mai) steht:

> „Tiefstwerte zwischen 1 und 4 Grad, im Aach- und Sittertal um 1 Grad. Höchstwerte um 15 Grad."

Laut Prompt-Regel müsste der Tiefstwerte-Satz hier zwingend mit `" - Bodenfrostgefahr."` enden (bei ≤ 4 Grad), bei ≤ 0 Grad mit `" - Frostgefahr in den Senken."`. Die Regel steht zwar im System-Prompt (`forecast.functions.ts` Z. 2445/2460/2461), wird aber **nicht deterministisch erzwungen** — das LLM lässt den Anhang gelegentlich weg, wie der aktuelle Eintrag zeigt.

Anders formuliert: Es gibt aktuell **keine Frostwarn-Enforcement-Schicht** analog zum Nominalstil-Check.

## Lösung

Eine deterministische Post-Processing-Schicht ergänzen, die nach jeder Generierung prüft, ob ein Tiefstwerte-Satz vorhanden ist und ob der berechnete Tmin (aus `weatherData`) eine Frostwarnung erfordert. Falls ja und der Anhang fehlt → automatisch ergänzen.

### 1. Neuer Helper `enforceFrostWarning(text, weatherData)` in `forecast.functions.ts`

Logik:
- Tmin-Quelle: bevorzugt `weatherData.day.tmin_cold` (topografisch korrigierter Senken-Wert), Fallback `weatherData.day.corrected_tmin` bzw. `weatherData.day.tmin.avg`.
- Schwellen:
  - `tmin ≤ 0` → Anhang `" - Frostgefahr in den Senken."`
  - `tmin ≤ 4` → Anhang `" - Bodenfrostgefahr."`
  - sonst: keine Änderung; falls fälschlich vorhanden, **nicht** entfernen (konservativ).
- Im Body den ersten Satz finden, der mit „Tiefstwerte"/„Tiefste Werte" beginnt. Wenn er bereits mit `Bodenfrostgefahr.` oder `Frostgefahr in den Senken.` endet → keine Änderung. Sonst: den abschliessenden Punkt durch ` - <Anhang>` ersetzen.
- Wenn gar kein Tiefstwerte-Satz vorhanden ist (z. B. Tag-0-Nachmittag, der sie absichtlich weglässt) → keine Änderung.

### 2. Aufruf-Stellen

`enforceFrostWarning` direkt nach `generateTextNominal(...)` und vor dem Speichern aufrufen — analog zu `enforceSkyConsistency` / `stripTiefstwerteForAfternoon`. Betroffen sind dieselben Generierungspfade in:
- `src/server/forecast.functions.ts` (manuelle Generierung, ~Z. 2700–2970, drei Stellen)
- `src/server/forecast.auto.ts` (Cron-Auto, drei `generateTextNominal`-Aufrufe)

Reihenfolge: `nominal → strip-Tiefst-für-Tag-0-Nachmittag → frost-warn → sky-consistency` (Frost vor Sky, weil Sky den ersten Absatz ersetzt und Tiefstwerte typischerweise im zweiten Absatz stehen — unabhängig).

### 3. Logging

- Bei jeder Ergänzung `console.log("frost-enforce: appended X for tmin=Y")` — damit man im Log nachvollziehen kann, wann die KI patzte.

### 4. Test am aktuellen Eintrag

Nach Implementierung den Mittwoch-Eintrag (13. Mai, Tmin 1 Grad) neu generieren und prüfen, dass der Anhang `" - Bodenfrostgefahr."` automatisch erscheint, auch wenn die KI ihn weglässt.

## Außerhalb des Umfangs

- Keine Prompt-Änderung (die Regel ist bereits klar formuliert, das LLM hält sie nur nicht zuverlässig ein).
- Keine UI-Änderung in den Settings.
- Keine Anpassung der Schwellenwerte (4 °C / 0 °C bleiben).
