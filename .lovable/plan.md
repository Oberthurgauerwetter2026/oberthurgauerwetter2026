## Ziel

Den **Nominal- / Telegrammstil** in den generierten Prognosetexten verlässlicher durchsetzen, sodass auch beim wiederholten Generieren („Regenerate") konsequent Substantiv-Phrasen statt Vollverb-Sätze entstehen.

## Warum es heute schwankt

In `src/server/forecast.functions.ts`:

1. **Modell**: `google/gemini-2.5-flash` — schnell, aber stilschwächer; lange Promptlisten werden nicht zuverlässig befolgt.
2. **Keine `temperature`** im Request → Gateway-Default ist relativ hoch, dadurch hohe Streuung zwischen Generierungen.
3. **Nominalstil-Regel** steht mitten in einer langen Liste gleichrangiger „verbindlicher Regeln" — keine Hervorhebung, keine Kontrolle.
4. **Kein Post-Validator**: `enforceSkyConsistency` prüft nur Himmel/Wind/Temperatur, nicht den Stil. Verbalsätze werden also einfach durchgelassen.

## Umsetzung (4 kleine, gezielte Änderungen)

Alles in **einer** Datei: `src/server/forecast.functions.ts`.

### 1. Determinismus erhöhen — `temperature` setzen
In `generateText` (ca. Zeile 1062-1068) dem Request-Body `temperature: 0.2` und `top_p: 0.9` hinzufügen.

### 2. Modell-Upgrade
In `generateText` (Zeile 1063) `model: "google/gemini-2.5-flash"` → `model: "google/gemini-2.5-pro"`.
- Wirkung: deutlich stabilere Stil-Adhärenz, gleicher Anbieter, gleiches API.
- Kosten/Latenz: leicht höher, aber Generierung läuft ohnehin im Hintergrund.

### 3. Nominalstil-Block prominenter platzieren
In `DEFAULT_GENERAL_STYLE` (Zeile 1084-1102) den Nominalstil-Punkt aus der Liste herauslösen und als **eigenen, hervorgehobenen Block direkt unter der Überschrift** platzieren — mit klarem Label „OBERSTE STIL-REGEL (NOMINAL- / TELEGRAMMSTIL)" und 4-5 zusätzlichen Vorher/Nachher-Beispielen (Few-Shot direkt im Prompt). Die übrigen Regeln bleiben unverändert.

### 4. Leichter Post-Validator + 1× Retry
Neue Funktion `enforceNominalStyle(text: string): { text: string; violations: string[] }` direkt unter `enforceSkyConsistency` (ca. Zeile 138).
Erkennt typische Verbal-Phrasen per Regex, z. B.:
- `\b(scheint|scheinen)\b` (Sonne scheint)
- `\bziehen?\s+\w+\s+auf\b` (Wolken ziehen auf)
- `\bes\s+regnet\b`, `\bes\s+schneit\b`, `\bes\s+gewittert\b`
- `\bder\s+Wind\s+weht\b`
- `\bwir\s+erwarten\b`, `\bes\s+wird\s+\w+\b` (bereits verboten, jetzt aktiv geprüft)
- `\bzeigt\s+sich\b`, `\bpräsentiert\s+sich\b`, `\bgestaltet\s+sich\b`

Verwendung an den 3 Aufruf-Stellen von `generateText` (in `generateForecast`, `regenerateForecast`, `regenerateEntry`):
```
let body = await generateText(systemPrompt, userPrompt);
const check = enforceNominalStyle(body);
if (check.violations.length > 0) {
  // 1× Retry mit verschärftem User-Prompt-Hinweis
  body = await generateText(
    systemPrompt,
    userPrompt + `\n\nWICHTIG: Im vorherigen Versuch wurden Vollverb-Phrasen verwendet (${check.violations.join(", ")}). Schreibe ZWINGEND im Nominalstil — keine finiten Vollverben.`
  );
}
body = enforceSkyConsistency(body, weatherData);
```
Nur **ein** Retry, um Latenz und Kosten zu begrenzen. Kein harter Abbruch — falls auch der Retry noch Verstösse enthält, wird der Text trotzdem gespeichert (besser ein leicht verbalisierter Text als gar keine Prognose).

## Was sich NICHT ändert

- Kein Schema-/DB-Change.
- Keine Änderung an Tagesschleife, Trend-Tagen (Tag 7-10), MOSMIX-Fallback.
- `enforceSkyConsistency` bleibt unverändert.
- Bestehende gespeicherte Prognosen bleiben unangetastet.
- `app_settings`-Override für Prompts funktioniert weiterhin (der hervorgehobene Nominal-Block landet nur im Default; eigene Templates bleiben gültig).

## Erwartetes Ergebnis

- Beim Erst- und beim wiederholten Generieren konsequent Telegramm-/Nominalstil.
- Verbalsätze nahezu eliminiert (Regex-Validator + Retry fängt die häufigsten Fälle).
- Generierungszeit pro Eintrag im Schnitt +1-3 s (Pro-Modell), bei Verstoss zusätzlich +1 Aufruf — akzeptabel im Hintergrund-Job.
