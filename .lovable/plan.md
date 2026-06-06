## Ziel
Die Einstellungsseite soll nicht mehr den alten WordPress-/Public-Bucket-Einbettungsweg zeigen. Stattdessen soll nur noch die aktuelle öffentliche Karten-URL der veröffentlichten App verwendet werden.

## Änderungen
1. **Druckkarten-Karte in den Einstellungen vereinfachen**
   - Den kompletten Cyon-/`druckkarte.php`-Block entfernen.
   - Das Feld **„Einbettungs-HTML“** entfernen, damit keine veraltete WordPress-HTML-Version mehr angezeigt wird.
   - Stattdessen nur die direkte öffentliche Bild-URL anzeigen und kopierbar machen: `https://oberthurgauerwetter2026.lovable.app/api/public/maps/europe-pressure-latest.svg`.

2. **Generierte/gespeicherte alte Cyon-URL ignorieren**
   - `pressureMapCyonUrl` aus der UI-Logik entfernen, damit ein alter lokaler Wert im Browser nicht mehr weiterverwendet wird.
   - Die aktive Bild-URL immer aus der veröffentlichten App-Domain + Proxy-Route bilden.

3. **Veraltete Public-Storage-Rückgabe im Karten-Generator korrigieren**
   - In `pressure-map.server.ts` werden aktuell noch direkte `/storage/v1/object/public/weather-maps/...` URLs zurückgegeben.
   - Diese Rückgaben auf die App-Proxy-URL umstellen, damit auch Status-/Job-Ergebnisse nicht mehr auf den alten Public-Bucket-Weg verweisen.

4. **Proxy-Endpunkt unverändert lassen**
   - `/api/public/maps/europe-pressure-latest.svg` bleibt bestehen und liest weiterhin aus dem privaten `weather-maps` Bucket.
   - Der Bucket bleibt privat; kein Public-Bucket-Schalter wird benötigt.

## Ergebnis
In den Einstellungen ist nur noch die aktuelle öffentliche Karten-URL sichtbar. Keine Anleitung zu Public Bucket, kein Cyon-Workaround, kein Einbettungs-HTML und keine direkte Storage-URL mehr.