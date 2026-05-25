# R2-Cache: Setup-Anleitung

Diese Skripte entkoppeln Open-Meteo vom Worker. Eine GitHub Action zieht
alle 5 min die Hot-Path-Forecasts in einen Cloudflare-R2-Bucket; der Worker
liest danach nur noch R2.

## Voraussetzungen (einmalig, manuell)

1. **R2-Bucket anlegen** (Cloudflare Dashboard → R2 → Create bucket).
2. **Public Access aktivieren** → Custom Domain oder `r2.dev`-URL notieren
   (z.B. `https://pub-xxx.r2.dev`).
3. **R2-API-Token erstellen** (R2 → Manage R2 API Tokens → Object Read & Write):
   - `R2_ACCOUNT_ID` (Cloudflare Account ID)
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET` (Bucket-Name)
4. **GitHub-Secrets setzen** im Repo unter Settings → Secrets and variables →
   Actions: die 4 Werte aus Schritt 3.
5. **Worker-Secret setzen**: `R2_PUBLIC_URL` (= URL aus Schritt 2) im Lovable-
   Projekt hinzufügen. Wird automatisch beim nächsten Deploy aktiv.

## Erster Test

```
gh workflow run "Open-Meteo Cache Ingest"
```

oder im GitHub-UI: Actions → "Open-Meteo Cache Ingest" → Run workflow.

Anschliessend in R2 prüfen, dass `openmeteo/forecast.json` existiert.

## Region anpassen

Standard: Amriswil + 15 km (BBox 47.45-47.65 / 9.20-9.45, Grid 7×7).
Ändern via Workflow-`env` oder Repo-Variables:

```yaml
env:
  BBOX_MIN_LAT: "47.40"
  BBOX_MAX_LAT: "47.70"
  GRID_LAT: "9"
  GRID_LON: "9"
```
