## Befund

Die App selbst stürzt im Preview nicht sichtbar ab: `/dashboard` zeigt kurz `Lädt…` und leitet ohne gültige Sitzung auf `/login` weiter.

Das eigentliche Problem bei den Karten ist der öffentliche Karten-Endpunkt:

- `https://oberthurgauerwetter2026.lovable.app/api/public/maps/europe-pressure-latest.svg` läuft aktuell in ein Timeout bzw. `500 Internal Server Error`.
- `/api/public/maps/dwd-bodenanalyse.png` liefert ebenfalls `500`.
- Ursache: Die Routen laden die grossen Dateien serverseitig aus dem Kartenspeicher und streamen sie durch die App-Route. Das ist für die 1.3 MB SVG und besonders die 4.6 MB DWD-PNG im Live-Server zu langsam/instabil. Dadurch sieht man nur eine weisse Seite bzw. die Bilder bleiben leer.

## Plan

1. **Karten-Endpunkte stabil machen**
   - `src/routes/api/public/maps/europe-pressure-latest[.]svg.ts`
   - `src/routes/api/public/maps/dwd-bodenanalyse[.]png.ts`
   - Statt die Bilddatei komplett über die App-Route zu downloaden und zurückzustreamen, erzeugt die Route eine kurzlebige, sichere Speicher-URL und leitet per `302` dorthin weiter.
   - Die öffentliche URL bleibt gleich und dauerhaft verwendbar:
     - `/api/public/maps/europe-pressure-latest.svg`
     - `/api/public/maps/dwd-bodenanalyse.png`

2. **Fehlerantworten klarer machen**
   - Wenn die gespeicherte Karte fehlt oder keine Speicher-URL erzeugt werden kann, antwortet die Route schnell mit einer verständlichen Textmeldung statt mit Timeout/500.
   - CORS- und Cache-Header bleiben erhalten.

3. **Vorschau/Einbettung unverändert lassen**
   - Die Settings-Seite und WordPress-Einbettungscodes können weiterhin dieselben stabilen URLs verwenden.
   - Nach dem Fix müssen die Karten nicht neu generiert werden; die bereits gespeicherten Dateien werden verwendet.

4. **Prüfen nach Umsetzung**
   - Beide öffentlichen Karten-URLs direkt aufrufen.
   - Erwartung: kein weisser Screen/kein 500, sondern Weiterleitung auf das Bild und sichtbare Karte.

Nach Umsetzung muss die App erneut veröffentlicht werden, damit die Live-URLs den Fix verwenden.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>