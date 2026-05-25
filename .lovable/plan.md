## Ziel

Open-Meteo-Calls vom Worker entkoppeln → kein Shared-IP-Throttle mehr. GitHub Action ingestiert alle 5 min in R2, Worker liest nur noch Cache.

## Bestandsaufnahme

Open-Meteo wird in 11 Server-Dateien aufgerufen, jede mit anderer Variable/Modell-Kombination:

| Datei | Endpoint | Variablen / Modelle |
|---|---|---|
| `forecast.functions.ts` (684, 848) | /forecast | Multi-Modell Tag1-7, Multi-Variable (Temp/Wind/Sky/Niederschlag) |
| `forecast.auto.ts` (139, 692) | /forecast | wie oben, Auto-Daily-Variante |
| `ensemble.server.ts` | /ensemble | ICON-EU/IFS Ensemble-Members |
| `nowcast.server.ts` | /forecast | minutely_15 Niederschlag/Temp |
| `radar.server.ts` (2×) | /forecast | minutely_15 Niederschlag-Grid |
| `bias-correction.server.ts` | /forecast | rückblickender Vergleich (past_days) |
| `pressure-gradient.server.ts` | /forecast | Druck an 4 Eckpunkten |
| `pressure-map.server.ts` | /forecast | Druckfeld-Grid |
| `synoptic-trend.server.ts` | /forecast | 500-hPa-Strömung |
| `snow-line.server.ts` | /forecast | Geopotential / 0°-Grenze |
| `forecast.functions.ts` (518) / `forecast.auto.ts` (592) | /elevation | einmalig, irrelevant |

Das ist deutlich mehr als der Skill-Template (`phase1` = ICON-CH1-minutely, `phase2` = ICON-CH2-hourly für 1 Grid). Eine einzige `forecast.json` deckt **nicht** alles ab.

## Vorgeschlagene Migration in 3 Wellen

### Welle 1 (sofort, größter Effekt) — Hot-Path-Forecast cachen

Ingest 1× `forecast.json` für die Variablen, die `forecast.functions.ts` + `forecast.auto.ts` + `nowcast.server.ts` brauchen. Diese drei machen >80% aller Calls.

- **Workflow**: `.github/workflows/openmeteo-ingest.yml`, alle 5 min, ruft `scripts/ingest_openmeteo.py`.
- **Ingest-Skript**: angepasst an Amriswil-Region (BBox 47.45–47.65 / 9.20–9.45, Grid 7×7), holt 3 Phasen:
  - Phase A — Multi-Modell, hourly, Tag 0-7 (Temp, Wind, Sky, Niederschlag, RH)
  - Phase B — ICON-CH1, minutely_15, ±6h (Nowcast/Radar-Niederschlag)
  - Phase C — Bias-Lookback, past_days=7, hourly (Temp/Wind)
- **R2-Key**: `openmeteo/forecast.json` (CacheControl: `s-maxage=120`).
- **Worker-Reader**: neuer Helper `src/server/openmeteo-cache.server.ts` mit `loadOpenMeteoCache()` → fetcht von `R2_PUBLIC_URL`, parst, memoized per Request.
- **Umstellung**: `forecast.functions.ts`, `forecast.auto.ts`, `nowcast.server.ts`, `radar.server.ts`, `bias-correction.server.ts` lesen aus dem Cache. Wenn Cache fehlt/stale → `getGlobalThrottle()`-Pfad bleibt als Fallback aktiv (kein Verhalten gebrochen).

### Welle 2 (optional, später) — Druck/Synoptik

Wenn Welle 1 stabil läuft: zweite R2-Datei `openmeteo/pressure.json` für `pressure-gradient`, `pressure-map`, `synoptic-trend`, `snow-line`. Eigener Workflow (z.B. alle 30 min, da langsamere Felder).

### Welle 3 (nicht jetzt) — Ensemble

`ensemble.server.ts` zieht große Ensemble-Members → eigene Strategie nötig, ggf. weiter via Cyon-Proxy.

## Was bleibt unverändert

- `pressure-map-generator/` (eigener Use-Case, eigene IP, läuft schon getrennt — Skill sagt explizit "nicht anfassen").
- `cyon-proxy/om-proxy.php` als Notfall-Fallback (2-4 Wochen behalten, dann Entscheidung).
- Bestehende `weather_cache`-Tabelle + `openmeteo-quota.server.ts` (Throttle-Logik) bleiben als Sicherheitsnetz für Pfade, die nicht aus R2 lesen.

## Voraussetzungen vom User

- Cloudflare R2 Bucket + Public URL.
- GitHub-Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- Worker-Env: `R2_PUBLIC_URL` (z.B. `https://pub-xxx.r2.dev`).

## Offene Fragen vor Implementierung

1. **R2-Bucket schon vorhanden?** (Der bestehende `weather-maps`-Supabase-Bucket ist ein anderes System.) Falls nein: Bucket anlegen + Public URL bereitstellen, sonst kann der Worker nichts lesen.
2. **Scope**: nur Welle 1 jetzt, oder Welle 1+2 zusammen? Empfehlung: **nur Welle 1** — schnell live, geringes Risiko, deckt den Auslöser des heutigen 18:41-Throttles ab.
3. **Region/Grid bestätigen**: BBox 47.45–47.65 / 9.20–9.45, Grid 7×7 — passt zu Amriswil + 15 km?
