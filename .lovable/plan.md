## Ziel
Den Storage-Bucket `weather-maps` wieder auf **public** schalten, damit die Druckkarte direkt von der Lovable-Cloud-URL geladen werden kann (ohne Proxy).

## Schritte
1. `weather-maps` Bucket auf `public: true` setzen.
2. Im Settings-Code (`src/routes/_app.settings.tsx`) den Einbettungs-Code wieder auf die direkte Public-Storage-URL umstellen (statt `/api/public/maps/europe-pressure-latest.svg`), damit der WordPress-Embed wie früher direkt vom CDN lädt.
3. Anzeige-`<img>` in den Einstellungen ebenfalls auf die Direkt-URL umstellen.

## Hinweis
Der bisherige Proxy-Route bleibt als Fallback bestehen — er stört nicht, falls du später wieder umschalten willst.

## Sicherheits-Hinweis
Mit `public = true` ist jedes Objekt im Bucket `weather-maps` über die direkte Storage-URL für alle aufrufbar. Das ist für die öffentliche Wetterkarte gewünscht — lege bitte keine sensiblen Dateien in diesem Bucket ab.