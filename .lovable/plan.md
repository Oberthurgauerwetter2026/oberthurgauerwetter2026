## Befund

Das ist kein echtes eigenes Tageslimit: Die Datenbank zeigt heute nur **36 eigene Open-Meteo-Calls** bei einem Limit von 10'000. Trotzdem kommen täglich `daily`-429-Antworten von wechselnden Quellen (`pressure_map`, `radar`, `nowcast`, `pressure_gradient`). Das Muster passt zu einem **geteilten Ausgehenden-IP-Limit** beim öffentlichen Open-Meteo-Endpunkt.

Die letzte Änderung wirkt bereits teilweise: die aktuellen Marker laufen nur 45 Minuten und enthalten `RATE_LIMIT_HOURLY` statt Tagesblockade. Das Problem bleibt aber, weil der Forecast während dieses 45-Minuten-Fensters trotzdem sofort als **MOSMIX-only** erzeugt und gespeichert wird. Danach bleibt der schlechte Bericht stehen, auch wenn Open-Meteo kurz später wieder verfügbar wäre.

## Ziel

Kein täglicher „Eingeschränkter Modus“ mehr als Standardverhalten. Temporäre Open-Meteo-429 sollen abgefedert werden durch Wiederverwenden brauchbarer Daten, sauberes Zurückstellen und präzisere Meldungen.

## Plan

### 1. Gemeinsame Open-Meteo-Fehlerlogik zentralisieren

**Datei:** `src/server/openmeteo-quota.server.ts`

- Den bisherigen einfachen Fetch-Wrapper zu einem robusten Open-Meteo-Client erweitern:
  - 429-Body klassifizieren: daily/hourly/minutely.
  - Bei `daily`-429 und eigener Nutzung < 500 Calls: als **Shared-IP-Throttle** behandeln.
  - Einen kurzen globalen Marker setzen, z. B. `om:global-throttle`, für 45 Minuten.
  - Einheitliche Fehlerklasse exportieren, damit alle Module gleich reagieren.
- Alle Open-Meteo-Nebenmodule sollen bei aktivem globalem Marker **keinen neuen Open-Meteo-Call** starten, sondern sauber `null`/leere Zusatzdaten liefern.

Betroffene Nebenmodule:
- `radar.server.ts`
- `nowcast.server.ts`
- `pressure-gradient.server.ts`
- `snow-line.server.ts`
- `synoptic-trend.server.ts`
- `ensemble.server.ts`
- `bias-correction.server.ts`
- `pressure-map.server.ts` nur soweit nötig angleichen, weil dort schon ähnliche Logik existiert.

### 2. Forecast darf bei temporärem Shared-IP-Throttle nicht sofort MOSMIX-only speichern

**Datei:** `src/server/forecast.functions.ts`

- Die bestehende MOSMIX-only-Fallback-Logik unterscheiden:
  - **Echter Tageslimit-Fall:** eigene Nutzung hoch oder expliziter Tagesblock → MOSMIX-only ist zulässig.
  - **Temporärer Shared-IP-Throttle:** kein dauerhafter MOSMIX-only-Bericht speichern.
- Bei temporärem Throttle:
  - Erst versuchen, die letzte gute Open-Meteo-Cache-Version zu verwenden.
  - Wenn kein brauchbarer Cache vorhanden ist, eine verständliche Fehlermeldung zurückgeben: „Open-Meteo ist temporär gedrosselt, bitte in ca. 45 Minuten erneut generieren“.
  - Keine neuen `forecast_entries` mit dem irreführenden Tageslimit-Banner schreiben.

### 3. Stale-Cache-Fallback für Wetterkern einbauen

**Datei:** `src/server/weather-cache.server.ts` und Nutzung in `forecast.functions.ts`

- Eine Leseoption für abgelaufene, aber noch brauchbare Cache-Daten ergänzen.
- Für Forecast-Tiers:
  - Short-Term: abgelaufene Daten maximal einige Stunden verwenden.
  - Mid/Long-Term: abgelaufene Daten bis ca. 24–36 Stunden verwenden, weil sie für Tag 3–10 besser sind als MOSMIX-only.
- Wenn Stale-Daten genutzt werden, intern im `weather_data` markieren, aber den Bericht nicht als „Tageslimit erreicht“ ausgeben.

### 4. Berichtstext und Admin-Anzeige präzisieren

**Dateien:** `src/server/forecast.functions.ts`, ggf. `src/components/OpenMeteoUsageCard.tsx`

- Den Text „Open-Meteo Tageslimit erreicht“ nur noch bei echtem eigenen Tageslimit verwenden.
- Für Shared-IP-Fälle stattdessen:
  - „Open-Meteo temporär gedrosselt; letzte verfügbare Modelldaten wurden verwendet“ oder
  - „Generierung zurückgestellt, bitte später erneut versuchen“.
- Die Admin-Karte soll aktive Marker unterscheiden:
  - temporärer Shared-IP-Throttle
  - echtes Tageslimit
  - hourly/minutely throttle

### 5. Optionaler dauerhafter Exit: eigener Open-Meteo-Key

Falls du möchtest, kann ich zusätzlich eine optionale Secret-Unterstützung vorbereiten:

- Wenn `OPEN_METEO_API_KEY` gesetzt ist, wird statt dem öffentlichen Endpoint der Customer/API-Key-Endpunkt verwendet.
- Ohne Key läuft alles weiter wie bisher, nur robuster.

Das wäre die nachhaltigste Variante gegen Shared-IP-Probleme, weil sie das geteilte öffentliche Limit umgeht. Ich würde es optional bauen, ohne dich jetzt zu einem Key zu zwingen.

## Erwartetes Ergebnis

- Temporäre 429 blockieren nicht mehr täglich den ganzen Bericht.
- Kein gespeicherter MOSMIX-only-Bericht nur wegen eines kurzen Shared-IP-Throttles.
- Wenn Open-Meteo kurzzeitig nicht erreichbar ist, nutzt der Bericht letzte gute Modelldaten oder fordert einen späteren Retry an.
- Die Meldungen sagen künftig klar, ob es ein echtes Tageslimit oder nur eine temporäre Drosselung ist.