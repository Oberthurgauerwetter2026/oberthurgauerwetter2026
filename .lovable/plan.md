## Ziel
Die Einbindecodes sollen außerhalb der Preview zuverlässig funktionieren und dauerhaft auf die veröffentlichte App zeigen.

## Plan
1. **URLs korrigieren**
   - Die angezeigten Bild-URLs bleiben dauerhaft auf `https://oberthurgauerwetter2026.lovable.app`.
   - Zusätzlich werden echte HTML-Einbindecodes angezeigt, nicht nur reine Bild-URLs.

2. **CORS/Preflight absichern**
   - Für beide öffentlichen Karten-Endpunkte wird ein `OPTIONS`-Handler ergänzt.
   - Alle Antworten bekommen vollständige CORS-Header, damit WordPress/externe Seiten die Bilder laden können.

3. **DWD-Code robuster machen**
   - Der DWD-Endpunkt bleibt ein öffentlicher Proxy auf die aktuelle DWD-Bodenanalyse.
   - Fehlerantworten enthalten weiterhin keine sensiblen Details, aber genug Hinweis für Diagnose.

4. **Einstellungsseite verbessern**
   - Pro Karte gibt es dann:
     - dauerhafte Bild-URL
     - kopierbaren `<img ...>` Einbindecode
     - kurze Quellenangabe/Alt-Text im Code

## Nicht enthalten
- Keine Änderung am Karten-Generator selbst.
- Keine Datenbankänderung.
- Keine Änderung an der Preview-Darstellung der Bilder in den Einstellungen.