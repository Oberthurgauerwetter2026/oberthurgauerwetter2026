## Problem

Der Bucket `weather-maps` wurde im letzten Schritt privat gestellt. Die Settings-Seite (`PressureMapCard`) lädt die Karte aber immer noch direkt über die alte public-Storage-URL:

```
https://kdolnotjbhgjieznmpgf.supabase.co/storage/v1/object/public/weather-maps/europe-pressure-latest.svg
```

Diese URL liefert jetzt 400/403 → die Karte erscheint nicht. Die Proxy-Route `/api/public/maps/europe-pressure-latest.svg` (mit Service-Role-Download) ist bereits vorhanden und funktioniert.

## Fix

In `src/routes/_app.settings.tsx`:

1. Konstante `SUPABASE_MAP_URL` ersetzen durch die Proxy-Route:
   ```ts
   const PRESSURE_MAP_URL = "/api/public/maps/europe-pressure-latest.svg";
   ```
2. `<img src>` im Card auf `${PRESSURE_MAP_URL}?v=${bust}` umstellen.
3. WordPress-Einbettung (`embedUrlForWordpress`) als Default ebenfalls auf die Proxy-URL umstellen — aber als **absolute** URL über `window.location.origin` (bzw. die Published-Domain), damit das HTML auch ausserhalb der App funktioniert. Cyon-URL-Override bleibt unverändert.

Keine Änderungen an der Route, am Bucket, an Generator/GitHub Action oder am Backend.

## Verifikation

- Vorschau auf `/settings` öffnen → Bodendruckkarte muss wieder sichtbar sein.
- Im generierten Einbettungs-HTML steht eine absolute URL auf `…/api/public/maps/europe-pressure-latest.svg`.
