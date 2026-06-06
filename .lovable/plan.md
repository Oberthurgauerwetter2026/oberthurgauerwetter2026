## Ziel
Im Settings-Block „Einbettungs-HTML" wird beim Nutzer noch alter Code mit blauem Rand angezeigt. Es soll dort der aktuelle, schlanke `<img>`-Tag (ohne Rahmen) erscheinen, der zur neuen Proxy-URL `/api/public/maps/europe-pressure-latest.svg` zeigt.

## Vorgehen
1. **Quellcode prüfen** (`src/routes/_app.settings.tsx`, Zeilen 688–691): Im aktuellen Source steht bereits:
   ```html
   <img src="…" alt="…" style="max-width:100%;height:auto" />
   ```
   Kein blauer Rand. Wenn du den alten Code trotzdem siehst, hängt das an einem veralteten Build im Preview/Live.

2. **Hard-Reload erzwingen**: Cache-Buster im generierten String ergänzen oder einen Kommentar einfügen, damit Vite/HMR die Datei garantiert neu auswertet. Falls nötig, Dev-Server neu starten.

3. **Falls gewünscht**: Den Embed-Code zusätzlich um `loading="lazy"` und `decoding="async"` ergänzen (klein, optional).

4. **Publish**: Nach Verifikation im Preview erneut publishen, damit `oberthurgauerwetter2026.lovable.app/settings` den neuen Code zeigt.

## Bitte vorab kurz bestätigen
Schick mir bitte den **exakten Text**, der bei dir aktuell im Textfeld „Einbettungs-HTML" steht (Copy-Paste). Damit kann ich sicher unterscheiden zwischen:
- veraltetem Build (Code im Repo ist schon korrekt → nur Republish nötig), oder
- tatsächlich noch vorhandenem alten Markup an einer anderen Stelle, die ich übersehe.

Sobald ich den Text habe, setze ich die Änderung in einem Schritt um.