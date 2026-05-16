# Externe Generierung der Bodendruckkarte

## Ziel
Die Druckkarte nicht mehr im Lovable-Backend (Cloudflare Worker) rendern, sondern in einer eigenen externen Umgebung mit eigener IP. Damit umgehen wir das geteilte 429-Limit von Open‑Meteo, das den aktuellen Worker blockiert.

## Empfohlene Lösung: GitHub Actions als Generator

GitHub Actions Runner haben eigene IPs (nicht geteilt mit dem Lovable-Pool), sind kostenlos für öffentliche Repos und bieten Cron‑Scheduling. Sie laden die Open‑Meteo‑Daten, rendern die SVG, und laden sie direkt in den vorhandenen Supabase Storage Bucket `weather-maps` hoch. Die App liest die Datei unverändert wie bisher.

```text
GitHub Actions (cron alle 3h)
   └─ Node-Script: Open-Meteo holen → SVG bauen → Storage Upload
        └─ Supabase Storage: weather-maps/europe-pressure-latest.svg
             └─ Lovable App liest unverändert
```

## Was sich ändert
- Neues Repo (oder Unterordner im bestehenden Repo) `pressure-map-generator/` mit:
  - `generate.mjs` — portierte Logik aus `src/server/pressure-map.server.ts` (ohne Worker‑Spezifika).
  - `.github/workflows/pressure-map.yml` — Cron `15 4,6,9,13,17 * * *` UTC.
- GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Lovable‑seitig:
  - Bestehenden pg_cron‑Job, der `/api/public/hooks/generate-pressure-map` aufruft, deaktivieren.
  - Route + `pressure-map.server.ts` als Fallback behalten (manueller Trigger im Admin).
  - `app_settings.pressure_map_last_run/status` weiterhin aktualisieren — entweder das GitHub‑Script schreibt direkt in die Tabelle, oder es ruft einen schmalen Webhook auf.

## Vorteile
- Eigene IP → kein Shared‑IP‑Throttling mehr.
- Keine Worker‑Runtime‑Limits (CPU, Speicher, Bundling von `sharp` etc. möglich, falls später PNG gewünscht).
- Logs + Re‑Runs direkt in GitHub sichtbar.

## Alternativen (kurz)
- **Cloudflare Worker in eigenem Account**: gleiches Shared‑IP‑Risiko, kein Gewinn.
- **Kleiner VPS / Fly.io Machine**: stabilste Lösung mit fixer IP, aber Betriebsaufwand und Kosten.
- **Open‑Meteo Commercial Plan**: höhere Limits ohne Infra‑Wechsel, aber kostenpflichtig.

## Offene Fragen
1. Eigenes GitHub‑Repo dafür anlegen, oder Generator‑Ordner ins bestehende Lovable‑Repo legen?
2. Soll der Generator `app_settings` direkt via Service‑Role schreiben, oder lieber einen kleinen authentifizierten Webhook in Lovable aufrufen?
3. Aktuelles Cron‑Intervall (04:15 / 06:15 / 09:15 / 13:15 / 17:15 UTC) beibehalten?
