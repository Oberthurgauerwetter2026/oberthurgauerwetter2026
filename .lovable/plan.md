## Ziel

Die Generierung soll nicht mehr komplett scheitern, wenn Open-Meteo das Tageslimit (HTTP 429) erreicht hat. Stattdessen soll die App, wo möglich, mit MOSMIX (DWD) weiterarbeiten und ansonsten eine **klare, ehrliche Fehlermeldung** zeigen.

## Was sich ändert

### 1. Klarere Fehlermeldung bei Rate-Limit
- `fetchOpenMeteo` erkennt HTTP 429 und wirft einen typed Error mit Code `RATE_LIMIT` statt der generischen Meldung.
- Wenn am Ende **gar keine** Wetterdaten verfügbar sind, sieht der Nutzer:
  > „Open-Meteo Tageslimit erreicht. Heute keine neue Generierung möglich, morgen wieder versuchen."
  
  statt dem irreführenden „bitte später erneut versuchen".

### 2. Negativ-Cache für 429-Antworten (1 Stunde)
- `fetchOpenMeteoOptional` speichert bei 429 einen Marker in der bestehenden `weather_cache`-Tabelle (Key z. B. `om:ratelimit:<modelset>`, TTL 1 h).
- Folgeaufrufe innerhalb dieser Stunde überspringen den HTTP-Call sofort → keine Latenz, keine zusätzlichen Calls in ein bereits erschöpftes Limit.
- Nach 1 h darf wieder probiert werden (Open-Meteo resetet täglich, aber 1 h ist ein guter Kompromiss zwischen Schonung und Reaktionsfähigkeit).

### 3. MOSMIX als Notfall-Quelle für Tag 0 + Tag 1
- MOSMIX liefert bereits heute Stationsdaten für Friedrichshafen + Konstanz (DWD, alle 6 h aktualisiert) und ist von Open-Meteo unabhängig.
- Wenn `fetchWeather` keinen Open-Meteo-`daily`-Block bekommt, baut der Generierungspfad ein synthetisches `daily`-Schema **nur für Tag 0 und Tag 1** aus den vorhandenen MOSMIX-Daten auf.
- Tag 2-9 entfallen in diesem Modus, weil MOSMIX dort keine Werte hat. Die Prognose wird automatisch auf 2 Tage gekürzt.
- Im UI/Body wird ein deutlicher Hinweis ergänzt: *„Eingeschränkter Modus — nur DWD-MOSMIX verfügbar (Open-Meteo Tageslimit erreicht). Mittel-/Langfrist heute nicht möglich."*

### 4. Wenn auch MOSMIX leer ist
- Klare Endmeldung mit Erklärung, was der Nutzer tun kann (morgen erneut probieren). Kein generisches „später erneut versuchen" mehr.

## Was sich NICHT ändert

- Keine DB-Migration (bestehende `weather_cache`-Tabelle reicht).
- Keine neuen Secrets / kein bezahlter API-Key (bewusst zurückgestellt).
- Keine Änderung am Prompt, an der Auswahl der Modelle oder am MOSMIX-Stationsset.
- Bestehende, bereits gespeicherte Prognosen bleiben unberührt.

## Technische Details

Datei: `src/server/forecast.functions.ts`

- `fetchOpenMeteo(...)` → bei 429: `throw Object.assign(new Error("Open-Meteo Tageslimit erreicht"), { code: "RATE_LIMIT" })`.
- `fetchOpenMeteoOptional(...)` → vor dem Call: Negativ-Cache prüfen via `getOrSetCache`-Lesepfad; bei 429-Fang: Marker schreiben (1 h TTL) und `null` zurückgeben.
- `fetchWeather(...)` → wenn `daily` null:
  - MOSMIX abfragen (`fetchMosmixShortTerm` mit aktivem Stationsset aus `app_settings.mosmix_stations`).
  - Falls MOSMIX Daten für heute/morgen liefert → minimales `daily`-Objekt synthetisieren (nur Tag 0 + 1) und mit Flag `degraded_mode: "mosmix_only"` zurückgeben.
  - Falls auch MOSMIX leer → Error mit klarem Text werfen.
- Generierungspfad (`generateForecast`): `degraded_mode`-Flag erkennen, Anzahl Einträge reduzieren und im Body-Header eine Hinweiszeile einfügen.

Keine Änderungen an UI-Komponenten nötig — der Hinweistext kommt automatisch im generierten Wetterbericht-Body mit.

## Erwartetes Verhalten nach dem Fix

| Situation | Heute | Nach dem Fix |
|---|---|---|
| Open-Meteo OK | Funktioniert | Funktioniert (unverändert) |
| Open-Meteo 429, MOSMIX OK | Komplettabbruch | Kurze Prognose Tag 0+1 mit Hinweis |
| Open-Meteo 429, MOSMIX leer | „später erneut versuchen" | „Tageslimit erreicht — morgen wieder" |
| Wiederholte Klicks bei 429 | Jeder Klick = 5 fehlgeschl. Calls | Sofortiges `null` aus Negativ-Cache |
