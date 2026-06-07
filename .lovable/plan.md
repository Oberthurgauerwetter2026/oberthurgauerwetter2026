Ich werde den bisherigen Ansatz ändern: Die DWD-Bodenanalyse wird nicht mehr bei jedem Aufruf live von DWD geladen. Stattdessen wird sie regelmäßig im Backend aktualisiert und als dauerhafte Datei ausgeliefert.

## Plan

1. **DWD-Live-Proxy entfernen**
   - `/api/public/maps/dwd-bodenanalyse.png` soll nicht mehr direkt bei DWD fetch'en.
   - Dadurch verschwindet das Problem `Upstream 400` für Besucher und WordPress-Einbindungen.

2. **DWD-Bild dauerhaft speichern**
   - Beim bestehenden automatischen Karten-Job wird die DWD-Bodenanalyse mit Browser-kompatiblen Headers geladen.
   - Das Ergebnis wird als feste Datei `dwd-bodenanalyse-latest.png` im bestehenden Karten-Speicher abgelegt.
   - Die öffentliche URL bleibt stabil: `https://oberthurgauerwetter2026.lovable.app/api/public/maps/dwd-bodenanalyse.png`.

3. **Endpoint nur noch gespeicherte Datei ausliefern lassen**
   - Der Endpoint lädt künftig die gespeicherte PNG-Datei aus dem Backend-Speicher.
   - Wenn die letzte Aktualisierung fehlschlägt, bleibt die zuletzt funktionierende Karte weiterhin verfügbar.
   - Fehler treten dann nur auf, wenn noch nie eine Datei erfolgreich gespeichert wurde.

4. **Bestehenden Cron-/Hook-Lauf erweitern**
   - Der bestehende Aktualisierungshook für die Druckkarte wird so erweitert, dass er zusätzlich die DWD-Bodenanalyse speichert.
   - Kein Preview-Link, kein wechselnder Link, kein `?v=...` im Einbindecode.

5. **Einstellungen bereinigen**
   - Die Codes bleiben dauerhaft auf der veröffentlichten Domain `https://oberthurgauerwetter2026.lovable.app`.
   - Hinweistext wird angepasst: „dauerhaft gespeicherte, automatisch aktualisierte Datei“ statt Live-Proxy.

## Technische Details

- Neuer Server-Helfer, z. B. `refreshDwdBodenanalyse()`, lädt das PNG und lädt es in den bestehenden `weather-maps` Speicher hoch.
- `src/routes/api/public/maps/dwd-bodenanalyse[.]png.ts` liest danach nur noch `dwd-bodenanalyse-latest.png` aus dem Speicher.
- `src/routes/api/public/hooks/generate-pressure-map.ts` ruft zusätzlich die DWD-Aktualisierung auf.
- CORS- und Cache-Header bleiben erhalten, damit WordPress und externe Seiten die Bilder laden können.