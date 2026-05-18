# Kartenanzeige in den Settings reparieren

## Problem

Die Settings-Seite lädt die Karten-URL über `getPressureMapStatus`. In der Preview wird daraus aktuell:

```text
https://localhost:8080/api/public/maps/europe-pressure-latest.svg
```

Diese URL ist aus dem Browser heraus nicht erreichbar, weil `localhost:8080` auf den Rechner des Besuchers zeigt und nicht auf die Lovable-Preview bzw. die veröffentlichte App. Dadurch bleibt das Bild leer.

Zusätzlich liefert die veröffentlichte Proxy-URL aktuell noch HTML statt SVG. Das deutet darauf hin, dass die letzte Änderung noch nicht veröffentlicht ist oder der Endpoint auf der veröffentlichten Version noch nicht aktiv greift.

## Lösung

1. **Bild-URL relativ ausgeben**
   - `getPressureMapStatus` soll statt einer absoluten `localhost`-URL nur noch die relative URL zurückgeben:
     ```text
     /api/public/maps/europe-pressure-latest.svg
     ```
   - Damit funktioniert die Vorschau automatisch auf Preview, Dev und nach Veröffentlichung auf der Live-Domain.

2. **WordPress-/Embed-URL im Frontend absolut machen**
   - In der Settings-Card wird aus der relativen URL für Anzeige und Embed automatisch eine absolute URL mit `window.location.origin` erzeugt.
   - Das HTML-Feld enthält dann eine echte vollständige URL, die in WordPress verwendet werden kann.

3. **Proxy-Route beibehalten**
   - Die Route `/api/public/maps/europe-pressure-latest.svg` bleibt die richtige Lösung, damit SVG inline angezeigt wird und nicht als Download bzw. `about:blank` endet.

## Hinweis zur Veröffentlichung

Damit die stabile URL außerhalb der Preview funktioniert, muss die App danach veröffentlicht/aktualisiert werden. Die Preview zeigt die Karte direkt nach der Änderung mit der relativen URL an.