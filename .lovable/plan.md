## Ziel

Tägliches API-Limit nicht mehr erreichen, ohne dass die kurzfristige Prognose (heute + morgen) an Aktualität verliert.

## Beobachtung

Pro Prognose-Lauf gehen aktuell raus:

- **3 Open-Meteo-Calls** für `fetchWeather` (short / mid / long)
- **2 data.tg.ch-Calls** + **2 Open-Meteo-Calls** für `buildStationBiases`

= **~7 Calls** pro `generateForecast`, `regenerateForecast` und Auto-Job.

Davon ändern sich **mid (Tage 3-5)** und **long (Tage 6-10)** sowie der Stations-Bias innerhalb eines Tages praktisch nicht — Tag 0/1 dagegen schon (neue Stundenwerte alle paar Stunden).

## Lösung: Tagescache ab Tag 3

Neue Tabelle `weather_cache` mit zwei separaten Cache-Slots, beide mit TTL bis Mitternacht (Europe/Zurich):

1. `mid_long` → Resultat von `fetchOpenMeteo` für mid- und long-Modelle.
2. `station_bias` → Resultat von `buildStationBiases()`.

Der **short-Tier (Tag 0-1) bleibt jedes Mal frisch** — dort steckt der Mehrwert einer Neugenerierung.

### Konkret

1. **Migration**: Tabelle `weather_cache`
   - Spalten: `cache_key text primary key`, `payload jsonb`, `fetched_at timestamptz default now()`, `expires_at timestamptz not null`.
   - RLS aktiviert, keine Policies → nur Service-Role/Server-Funktionen schreiben/lesen (Server nutzt den authentifizierten Client; falls RLS dort blockt, lesen wir den Cache über `supabaseAdmin`).

2. **Helper in `src/server/forecast.functions.ts`**
   ```ts
   getOrSet(cacheKey, ttlUntilMidnight, () => fetcher())
   ```
   - Liest Eintrag mit `expires_at > now()` aus `weather_cache`.
   - Bei Miss: führt Fetcher aus, upsertet Resultat mit `expires_at = nächste Mitternacht Europe/Zurich`.

3. **`fetchWeather` umbauen**
   - `shortData` weiterhin **immer** live abrufen (inkl. `hourly`).
   - `midData` und `longData` über `getOrSet("om:mid:<lat>,<lon>:<models>", …)` bzw. `om:long:…` — also höchstens 1×/Tag pro Modell-Set.

4. **`buildStationBiases` cachen**
   - In den Aufrufstellen (`generateForecast`, `regenerateForecast`, Auto-Job) durch `getOrSet("stations:bias", …, buildStationBiases)` ersetzen.

5. **Cache-Key inkludiert `lat`, `lon` und Modell-Liste**, damit eine Settings-Änderung den Cache automatisch invalidiert.

6. **Auto-Bereinigung**: Beim Schreiben optional `delete().lt("expires_at", now())` mitlaufen lassen — Tabelle bleibt klein.

### Effekt

Pro Folgelauf am gleichen Tag:

- **1 Open-Meteo-Call** (nur short) statt 3
- **0 Calls** für Stations-Bias (statt 4)

= **1 Call** statt **7** ab dem zweiten Lauf des Tages. Tageslimit wird damit auch bei vielen manuellen Regenerierungen nicht mehr erreicht.

### Was nicht geändert wird

- `regenerateEntry` benutzt schon nur die in der DB liegenden `weather_data` und macht keinen externen Call → bleibt wie es ist.
- Kein UI-Refresh-Button (Cache läuft täglich automatisch ab).
