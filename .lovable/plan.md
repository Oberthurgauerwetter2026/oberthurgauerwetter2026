## Ziel
Der "Eingeschränkte Modus" soll exakt dann enden, wenn Open-Meteo seine Tagesquota zurücksetzt — also bei **UTC-Mitternacht**. Aktuell wird der Negativcache stur 1 h fixiert, dadurch bleibt der Modus auch nach dem realen Reset noch bis zu 60 min aktiv und kann je nach Klick-Zeitpunkt mehrfach verlängert werden.

## Hintergrund
- Open-Meteo zählt Calls pro UTC-Tag. Reset = 00:00 UTC (= 02:00 Zürich CEST / 01:00 CET).
- In `src/server/forecast.functions.ts` (~Zeile 819–831) wird beim 429-Fehler ein Marker `om:ratelimit:<models>` mit fester TTL `Date.now() + 60*60*1000` in `weather_cache` geschrieben.
- `fetchOpenMeteoOptional` (Zeile 795–808) prüft diesen Marker und überspringt den HTTP-Call, solange `expires_at` in der Zukunft liegt → führt zu der Banner-Meldung in Zeile 2656/2816.

## Änderungen

**1. Neue Helper-Funktion `nextUtcMidnight()`** in `src/server/forecast.functions.ts`
```ts
function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0); // = 00:00 UTC am Folgetag
  return d.toISOString();
}
```

**2. TTL des Rate-Limit-Markers anpassen** (Zeile ~822)
```ts
// vorher: const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const expiresAt = nextUtcMidnight();
```
→ Marker läuft punktgenau zum Quota-Reset ab, nie länger, nie kürzer.

**3. Sicherheitsnetz: Sanity-Cap**
Falls `nextUtcMidnight()` durch Server-Clock-Drift mehr als 24 h in der Zukunft läge, auf `Date.now() + 24*60*60*1000` deckeln. (defensiv, einfacher `Math.min`).

**4. Log-Zeile** in `fetchOpenMeteoOptional` minimal anpassen, sodass im Log "rate-limit cache active until <UTC time>" klar als UTC erkennbar ist (kein funktionaler Change).

## Nicht geändert
- `getOrSetCache` / `nextMidnightZurich` für mid/long-Tier bleibt wie ist (positiver Cache an Zürich-Mitternacht ist korrekt, da nutzerseitig).
- Frontend-Banner-Texte bleiben.
- Keine UI-Änderung, kein manueller Reset-Button (gemäss Auswahl).

## Verifikation
- `weather_cache`-Eintrag `om:ratelimit:*` nach Auslösen prüfen → `expires_at` muss `T00:00:00.000Z` zeigen.
- Nach UTC-Mitternacht erneuter Forecast-Aufruf darf wieder Open-Meteo treffen (Logs: kein "skipping … rate-limit cache active").
