## Ziel
R2-Cache an den Worker anbinden und verifizieren, dass Open-Meteo-Calls nur noch aus dem Cache bedient werden.

## Schritte

1. **Secret setzen**: `R2_PUBLIC_URL = https://pub-66bea5418ed64bd6bc1d97a547548488.r2.dev` via `add_secret` anfordern (du gibst den Wert im sicheren Formular ein).
2. **Veröffentlichen**: Publish auslösen, damit der Debug-Endpoint `/api/public/debug/r2-cache` und der aktualisierte Worker live gehen.
3. **Cache verifizieren**: `/api/public/debug/r2-cache` aufrufen und prüfen:
   - `ok: true`
   - `age_minutes` < 10
   - `phaseA/B/C_locations = 49`
4. **Worker-Verhalten prüfen**: Server-Logs auf `[openmeteo-cache] served … from R2 phase=…` filtern, um zu bestätigen, dass echte Anfragen aus R2 bedient werden.
5. **Browser-Test**: Dashboard öffnen, Network-Tab — es darf kein direkter `api.open-meteo.com`-Call mehr vom Worker (SSR/Serverfunktionen) ausgehen.

## Rückfall
Falls Schritt 3 fehlschlägt (404/CORS): R2-Bucket Public Access erneut prüfen, ggf. den Objektpfad `openmeteo/forecast.json` im Bucket validieren.
