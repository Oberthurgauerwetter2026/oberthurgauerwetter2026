# Ingest-Workflow gegen DNS-Hänger und Mitternachts-Rollover härten

## Befund

Letzter Fehler im GitHub-Runner:

```
network error: ... Failed to resolve 'api.open-meteo.com'
([Errno -3] Temporary failure in name resolution)
```

Das ist ein **Runner-seitiger DNS-Glitch**, kein Code-Bug. Aktuell:
- 4 Versuche mit 2 s / 5 s / 10 s Backoff → Job bricht nach ~17 s ab.
- Schedule läuft erst 5 min später wieder.
- Wenn der DNS-Aussetzer genau **um Mitternacht UTC** passiert (oder mehrere Läufe in Folge betroffen sind), bleibt der Cache auf dem Vortagsdatum hängen — genau das Symptom von vorhin.

## Plan

### 1. Robusteren Retry im Ingest-Script
`scripts/ingest_openmeteo.py`:
- Backoff verlängern: z. B. `(3, 8, 20, 45, 90)` Sekunden → 6 Versuche über ~3 min. Bei DNS-Schluckauf reicht das fast immer.
- DNS-Fehler explizit als retry-würdig behandeln (heute schon ok, aber Logging klarer machen).
- Beim finalen Scheitern Exit-Code 1 (bleibt so), damit GitHub den Job rot markiert.

### 2. Workflow-Schritt retry-fähig
`.github/workflows/openmeteo-ingest.yml`:
- `nick-fields/retry@v3` (oder einfach ein Shell-`for`-Loop) um den `python`-Aufruf legen: bis zu 3 Versuche, je 60 s Pause. So überlebt ein Lauf einen mehrere Minuten dauernden DNS-Hänger des Runners.
- `timeout-minutes: 5` → `10` anheben (damit Retries reinpassen).

### 3. Backup-Schedule um Mitternacht
Zusätzlich zum 5-min-Cron einen dedizierten Cron `1,3,6,10,15 0 * * *` ergänzen — direkt nach Mitternacht UTC mehrfach versuchen, damit der erste „Tag-N+1"-Datensatz garantiert in R2 landet, selbst wenn der reguläre 00:00-Lauf scheitert.

### 4. (Optional) Workflow-Notification
Bei drei aufeinanderfolgenden Fehlversuchen eine Mail/Issue auslösen (`peter-evans/create-issue-from-file` oder GitHub-Email-Notifications für failed Actions im Account-Profil aktivieren). So merkst du längere Ausfälle sofort.

## Technische Details

`scripts/ingest_openmeteo.py`:
```python
RETRY_BACKOFFS = (3, 8, 20, 45, 90)  # statt (2, 5, 10)
```

`.github/workflows/openmeteo-ingest.yml`:
```yaml
- name: Run ingest (with retries)
  uses: nick-fields/retry@v3
  with:
    timeout_minutes: 5
    max_attempts: 3
    retry_wait_seconds: 60
    command: python -u scripts/ingest_openmeteo.py
  env:
    R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
    R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
    R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
    R2_BUCKET: ${{ secrets.R2_BUCKET }}
```

Schedule-Erweiterung:
```yaml
on:
  schedule:
    - cron: "*/5 * * * *"
    - cron: "1,3,6,10,15 0 * * *"   # Mitternachts-Rollover-Sicherung
  workflow_dispatch: {}
```

Bestätige den Plan, dann setze ich Schritt 1–3 um. Schritt 4 (Notification) lasse ich vorerst weg, da das einen extra Workflow erfordert; sag Bescheid, falls du das auch willst.