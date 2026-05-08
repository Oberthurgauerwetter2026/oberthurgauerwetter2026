## Ziel

Bei weathercode 45/48 (Nebel/Hochnebel) MUSS der Text "Nebel" oder "Hochnebel" enthalten — nie nur "stark bewölkt" / "bedeckt". Trigger: Mehrheit der Modelle (>50 %) liefert WC 45 oder 48.

## Änderungen in `src/server/forecast.functions.ts`

### 1. Helper `isFogMajority(weatherData)` (neu, ~Z. 185)

```ts
function isFogMajority(weatherData: any): boolean {
  const byModel = weatherData?.weathercode?.by_model;
  if (!byModel) return false;
  const vals = Object.values(byModel).filter((v) => v != null);
  if (!vals.length) return false;
  const fogCount = vals.filter((v) => v === 45 || v === 48).length;
  return fogCount / vals.length > 0.5;
}
```

Bestehende `fogByModel`-Logik in `buildDeterministicSkyParagraph` (Z. 187–192) auf diesen Helper umstellen, damit Schwelle konsistent ist.

### 2. Prompt-Verschärfung (`DEFAULT_SKY_RULES`, Z. 1807)

Aktuelle Zeile:
> "Bei weathercode 45 oder 48: formuliere als 'Nebel' oder 'Hochnebel' (NICHT als 'stark bewölkt')."

Ersetzen durch eine PFLICHT-Formulierung:
> "Bei weathercode 45 oder 48 bei der Mehrheit der Modelle: Du MUSST 'Nebel' oder 'Hochnebel' verwenden. Die Begriffe 'stark bewölkt' oder 'bedeckt' sind in diesem Fall VERBOTEN — auch wenn sunshine_h niedrig ist. Bei Auflösung im Tagesverlauf (sunshine_h ≥ 5h oder Stundenprofil zeigt Aufhellung): 'Nebel-/Hochnebelfelder am Morgen, im Tagesverlauf Auflösung'."

### 3. Post-Processing in `enforceSkyConsistency` (Z. 208)

Neue Stufe vor dem return: Wenn `isFogMajority(weatherData)`, prüfe den Text und ersetze "stark bewölkt" / "bedeckt" / "trübe" / "grau in grau" im ersten Absatz durch "Nebel- oder Hochnebelfelder", sofern weder "Nebel" noch "Hochnebel" bereits vorkommt. Wenn `buildDeterministicSkyParagraph` schon einen Satz erzeugt hat, ist der Fall abgedeckt — sonst greift dieses Replace.

Pseudo:
```ts
function enforceFogWording(text: string, weatherData: any): string {
  if (!isFogMajority(weatherData)) return text;
  if (/Nebel|Hochnebel/i.test(text)) return text;
  // Ersten Absatz ersetzen
  return text.replace(
    /\b(stark bewölkt|bedeckt|trübe|grau in grau)\b/i,
    "Nebel- oder Hochnebelfelder"
  );
}
```

`enforceSkyConsistency` ruft am Ende `enforceFogWording` auf.

### 4. `buildDeterministicSkyParagraph` (Z. 196–198)

Bei `fogMorning && !verySunny` wird aktuell trotzdem "und sonst stark bewölkt" geschrieben. Anpassen, so dass bei reinem Nebeltag (Mehrheit 45/48, kaum Auflösung) ein Satz ohne "stark bewölkt" entsteht, z. B.:
> "Verbreitet Nebel- oder Hochnebelfelder, nur zögerliche Aufhellungen."

## Validierung

- Testfall A: alle Modelle WC = 3 → kein Eingriff, Text unverändert.
- Testfall B: 4/5 Modelle WC = 45, sunshine_h = 1.5 → erster Absatz enthält "Nebel" oder "Hochnebel", nicht "stark bewölkt".
- Testfall C: 3/5 Modelle WC = 45 (genau 60 %), sunshine_h = 7 → Auflösungsmuster mit Nebel-Wording.
- Testfall D: 2/5 Modelle WC = 45 (40 %, keine Mehrheit) → Regel greift nicht, alter Stil bleibt.

## Keine weiteren Änderungen

- Kein DB-/Schema-Eingriff.
- Keine UI-Anpassung.
- Modell-Aggregation, Tier-Logik und Bias-Korrektur bleiben unangetastet.