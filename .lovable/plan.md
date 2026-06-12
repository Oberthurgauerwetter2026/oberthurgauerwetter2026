## Befund

- R2-`forecast.json` ist seit ~2 h alt (`generatedAt 2026-06-12T06:08:06Z`) und enthält weiterhin nur **7 Tagesdatensätze** (12.06.–18.06.).
- Der letzte als „grün" gemeldete Action-Run hat den 12-Tage-Stand also **nicht** in den Bucket geschrieben — entweder ist der Ingest-Step durchgelaufen, aber mit altem Skriptstand, oder spätere Cron-Läufe scheitern weiter an DNS-Fehlern Richtung `api.open-meteo.com`.
- Solange der Cache 7 Tage hat, fehlt strukturell der Trend Tag 6–10.

## Ziel

Ingest robust genug machen, dass auch bei DNS-/Rate-Glitches auf den Runnern zuverlässig die 12-Tage-Version in R2 landet — mit dem bereits existierenden Cyon-Proxy (`cyon-proxy/om-proxy.php`) als zweiter Datenpfad.

## Plan

1. **Cyon-Proxy als Fallback-URL in den Ingest einbauen**
   - In `scripts/ingest_openmeteo.py` zusätzlich zwei optionale ENV-Vars lesen:
     - `OPENMETEO_PROXY_URL` (z. B. `https://wetter.cyon.example/om-proxy.php`)
     - `OPENMETEO_PROXY_KEY` (optional, wird als `X-Proxy-Key` Header gesendet)
   - `fetch(label, params)` so umbauen, dass es eine Liste von Endpunkten der Reihe nach probiert:
     1. Direkt: `https://api.open-meteo.com/v1/forecast` mit den bestehenden Params.
     2. Wenn `OPENMETEO_PROXY_URL` gesetzt: Proxy-Aufruf mit zusätzlich `__host=api.open-meteo.com&__path=/v1/forecast` und allen Original-Params.
   - Pro Endpunkt der bisherige Backoff (`3,8,20,45,90 s`). Erst wenn **alle** Endpunkte alle Versuche verbraucht haben, abbrechen.

2. **DNS-Resilienz beim Direktcall verbessern**
   - Vor dem ersten Direkt-Versuch einmal `socket.getaddrinfo("api.open-meteo.com", 443)` ausführen; bei `gaierror` direkt zum Proxy-Endpunkt wechseln statt erst 3 min lang in Retries zu hängen.
   - Pro Endpunkt ein `requests.Session` mit eigenem `urllib3` Retry-Adapter (Connect-Retries) verwenden, damit transient DNS/SSL Fehler nicht den ganzen Lauf killen.
   - Klarere Logzeilen: `[A] direct attempt 1/6 …` / `[A] switching to proxy after direct exhausted` — damit man im Action-Log eindeutig sieht, welcher Pfad lief.

3. **Workflow-Inputs erweitern**
   - `.github/workflows/openmeteo-ingest.yml`: in `env:` zusätzlich `OPENMETEO_PROXY_URL` und `OPENMETEO_PROXY_KEY` aus `secrets.*` durchreichen.
   - Concurrency-/Schedule-Block bleibt unverändert.

4. **Cyon-Proxy minimal absichern (optional, nur wenn Schlüssel gesetzt)**
   - `cyon-proxy/om-proxy.php`: `PROXY_SECRET` weiterhin per Konstante; im README einen Hinweis ergänzen, wie der Schlüssel synchron in den GitHub-Secrets (`OPENMETEO_PROXY_KEY`) hinterlegt wird. Keine Code-Änderung am PHP nötig, solange der User selber den Secret-String einträgt.

5. **Diagnose-Endpunkt belassen**
   - Die in der letzten Runde ergänzten Felder (`phaseA_daily_days`, `today_index`, `trend_6_10_capable`) bleiben. Nach dem nächsten erfolgreichen Ingest sollte `phaseA_daily_days = 12` und `trend_6_10_capable = true` erscheinen.

## Was der User selbst tun muss

- In den GitHub-Repo-Secrets zwei Einträge anlegen:
  - `OPENMETEO_PROXY_URL` → die Cyon-URL der `om-proxy.php`
  - `OPENMETEO_PROXY_KEY` → optional, gleicher String wie `PROXY_SECRET` im PHP
- Action „Open-Meteo Cache Ingest" einmal manuell triggern.

## Validierung

- Action-Log zeigt entweder „direct ok" oder eindeutig „switched to proxy" — und am Ende `uploaded openmeteo/forecast.json (~X bytes)`.
- `/api/public/debug/r2-cache` liefert danach:
  - `age_minutes < 10`
  - `phaseA_daily_days: 12`
  - `phaseA_daily_last` mindestens 10 Tage nach heute
  - `trend_6_10_capable: true`
- Eine frisch erzeugte Prognose enthält wieder den Eintrag „Trend Tag 6 – 10" in `forecast_entries`.

## Was bewusst NICHT geändert wird

- Kein UI-/Trend-Fallback bei zu wenigen Tagen — du hast diese Option nicht gewählt. Wenn der Cache nochmal alt wird, fehlt der Trend weiterhin sichtbar, statt mit interpolierten Werten getarnt zu werden.
- Keine Änderungen an `forecast.functions.ts` / `forecast.auto.ts` über die bereits aus der letzten Runde hinaus.
