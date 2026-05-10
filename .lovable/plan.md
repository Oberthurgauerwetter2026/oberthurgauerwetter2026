# Bodendruckkarte: 429-Fehler sauber behandeln

## Diagnose

Der Hook ist nach dem Publish live (`401`/`500` statt `404` ✓). Der eigentliche Generierungs-Fehler:

```
Open-Meteo batch 0..1300 failed: 429
"Daily API request limit exceeded. Please try again tomorrow."
```

**Ursache:** Die Worker-IPs der Live-Umgebung haben heute bereits das **Open-Meteo Tageslimit** erschöpft (durch parallele Forecast-Anfragen). Bis ~Mitternacht UTC kann die Karte nicht neu generiert werden. Direkte Tests aus anderen Netzen (Sandbox) funktionieren — das Problem ist IP-spezifisch.

Heute Nacht (Cron um 13:30 UTC am 11.05.) wird die Karte automatisch wieder erzeugt — vorausgesetzt das Limit zu diesem Zeitpunkt noch nicht aufgebraucht ist.

## Fix-Plan

Drei kleine Verbesserungen in `src/server/pressure-map.server.ts` und der Hook-Route:

### 1. Negativcache bei 429 (Mitternacht UTC)

Analog zum Forecast: Sobald ein Batch 429 zurückgibt, einen Marker in `weather_cache` schreiben:
- `cache_key = "om:ratelimit:pressure-map"`
- `expires_at = nächste 00:00 UTC`

Vor jedem Lauf prüfen → falls Marker aktiv → sofort mit klarer Meldung abbrechen statt 1300 erfolglose Requests zu schicken.

### 2. Frühabbruch bei wiederholten 429

Wenn die ersten 3 Batches alle 429 liefern → restliche Batches überspringen, Marker setzen, mit Klartext abbrechen:

```
Open-Meteo Tageslimit erreicht — Karte wird ab 00:00 UTC neu erzeugt.
```

Spart Logs, Zeit und vermeidet Cron-Timeouts.

### 3. Klarere Statusmeldung in `app_settings.pressure_map_last_status`

Statt generischem `Fehler (cron): Zu wenige gültige Druckwerte (0/1344)` → spezifisch:
- bei 429: `Pausiert: Open-Meteo Tageslimit erreicht (auto-retry 00:00 UTC)`
- bei anderem Fehler: bisheriger Text

## Was passiert heute, ohne Code-Änderung?

- Heute (10.05. nach 14:47 UTC) keine Neuerzeugung möglich.
- Cron um 13:30 UTC am **11.05.** sollte normal laufen, weil das Limit täglich um 00:00 UTC zurückgesetzt wird.
- Manuell auslösen jetzt ist sinnlos.

Empfehlung: **Den Plan implementieren**, damit der Hook in solchen Fällen sauber statt mit Stack-Trace abbricht und das Admin-Dashboard verständlich zeigt, warum die Karte nicht aktualisiert wurde.
