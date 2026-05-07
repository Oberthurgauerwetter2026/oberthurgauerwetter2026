## Problem

Für Freitag liefern die Modelle:
- **weathercode**: avg 24, ICON-D2 = **45 (Nebel)**, ICON-CH2 = 3 (bedeckt)
- **sunshine_h**: avg **9 h** (3.6–12.5), spread 8.9 h
- **cloudcover**: 75.9 % (nur ICON-D2)

Das ist ein klassisches **Morgennebel-/Hochnebel-Auflösungsmuster**: morgens dichter Nebel (cloudcover 100 %, sunshine 0), Auflösung im Vormittag, Nachmittag sonnig. Die KI bekommt aktuell zwar das Stundenprofil, aber:

1. In `DEFAULT_SKY_RULES` heisst es nur knapp: *„weathercode 0-1 = klar, 2 = teils bewölkt, 3 = bedeckt"* — **Code 45/48 (Nebel/Reifnebel) ist nicht abgedeckt**. Die KI behandelt 45 vermutlich wie „bedeckt".
2. Die Aggregation auf den Tagesmittelwert (avg 24) verwischt den Tagesgang. Die KI fällt auf eine generische „morgens stark bewölkt, später Wolken" Beschreibung zurück, weil sunshine_h 9 h zwar klar nach „ziemlich sonnig" rufen würde, aber das Stundenprofil hohe Wolken am Morgen zeigt.
3. Es gibt keinen expliziten **Hochnebel-/Nebelauflösungs-Hinweis**, der aus dem Stundenprofil abgeleitet wird.

## Lösung — drei kombinierte Massnahmen

### 1. weathercode 45/48 in die Sky-Regeln aufnehmen
Erweitere `DEFAULT_SKY_RULES` (Zeile 1676–1681) um eine explizite Regel:

> Bei weathercode 45 oder 48 (Nebel / Reifnebel): formuliere als „Nebel" oder „Hochnebel", NICHT als „stark bewölkt". Wenn parallel die Sonnenstunden ≥ 5 h sind, beschreibe ein typisches Auflösungsmuster („Nebel- oder Hochnebelfelder am Morgen, im Tagesverlauf Auflösung, am Nachmittag sonnig").

### 2. Automatische Erkennung „Nebel-Auflösung" aus dem Stundenprofil
Neue Hilfsfunktion `detectFogDissipation(profile)` direkt nach `buildHourlyProfile` (~Zeile 1019). Sie prüft:
- Frühe Stunden (06–10): cloudcover ≥ 90 % UND sunshine ≈ 0 UND (mind. ein Modell weathercode 45/48 für den Tag)
- Spätere Stunden (12–17): cloudcover ≤ 50 % ODER sunshine ≥ 30 min/h

Wenn beides zutrifft, setze ein neues Feld `sky_pattern: "nebel_aufloesung"` im Tag-Datensatz mit konkreten Stundenangaben (z. B. `dissipation_hour: 11`).

### 3. Pattern-Hint in den Prompt einspeisen
Im `userPrompt` (in `buildEntryUserPrompt`/`appendHourlyTable`, ~Zeile 1144 ff.) zusätzlich:

> Wenn `sky_pattern === "nebel_aufloesung"` gesetzt ist, MUSS die Beschreibung den Verlauf abbilden: „Nebel-/Hochnebelfelder am Morgen, ab dem späten Vormittag Auflösung, ab Mittag sonnig." Das Tagesmittel (sunshine_h, cloudcover) darf NICHT für eine pauschale „stark bewölkt"-Aussage verwendet werden.

## Resultat für Freitag
Statt „Am Morgen stark bewölkt … am Nachmittag wieder mehr Wolken" entsteht z. B.:

> „Am Morgen Nebel- oder Hochnebelfelder im Flachland — mit Blick nach Baden-Württemberg und in den Alpstein bereits sonnig. Auflösung der Nebelfelder gegen Mittag, am Nachmittag verbreitet sonnig."

## Was nicht geändert wird
- Aggregations-Logik, Bias-Korrektur, Stationsdaten, Radar-Korrektur bleiben unverändert.
- Andere Tage (ohne Nebelmuster) bleiben unverändert.
- Keine Datenbank-/UI-Änderungen.

## Technische Details (Dateien)
- `src/server/forecast.functions.ts`:
  - Zeile 1676–1681: Sky-Regeln um Code 45/48 + Auflösungsmuster ergänzen
  - Neue Funktion `detectFogDissipation` ~Zeile 1019
  - In `buildDayContext` (~Zeile 1220): `sky_pattern` setzen wenn erkannt
  - In `buildEntryUserPrompt` (~Zeile 1146): Pattern-Hint im Prompt-Text ergänzen