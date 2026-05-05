Ich sehe jetzt klarer, warum die Seite den Link als „abgelaufen“ meldet: Der Backend-Log zeigt, dass der Link beim Öffnen tatsächlich erfolgreich verifiziert wird (Login/Recovery über `/verify`), aber die App erkennt die daraus entstandene Sitzung nicht zuverlässig und fällt nach dem Timeout auf „kein gültiger Link“ zurück. Das ist kein Zustellproblem mehr.

Plan:

1. `src/routes/reset-password.tsx` robust umbauen
   - Nicht mehr zuerst `getSession()` prüfen und danach erst Tokens auswerten.
   - Zuerst immer URL-Parameter/Hash auswerten:
     - `?code=...` per `exchangeCodeForSession()`
     - `#access_token=...&refresh_token=...` per `setSession()`
     - Fehlerparameter klar anzeigen
   - Danach aktiv auf eine wiederhergestellte Sitzung warten, nicht nur 1.5 Sekunden blind per Timeout.
   - Nach erfolgreichem Link-Check erst die URL bereinigen, damit Reloads den Link nicht erneut verbrauchen.
   - Die Passwortfelder nur anzeigen, wenn `getUser()` oder eine Session sicher vorhanden ist.
   - Interne Debug-Ausgabe in der Konsole ergänzen, damit man bei einem erneuten Fehler sieht, ob der Browser `code`, `access_token`, `refresh_token` oder einen Fehler erhalten hat, ohne Tokens selbst auszugeben.

2. Recovery-Link mit OTP-Fallback unterstützen
   - Falls der Link nicht als Session-URL, sondern als `token_hash`/`type=recovery` ankommt, zusätzlich `verifyOtp({ type: 'recovery', token_hash })` verwenden.
   - Das deckt beide üblichen Auth-Link-Formate ab und verhindert, dass gültige Recovery-Links fälschlich als abgelaufen gelten.

3. `src/hooks/use-auth.tsx` entschärfen
   - Den globalen AuthProvider so anpassen, dass er Recovery-/Signed-In-Events nicht durch parallele Rollenabfragen oder Loading-State-Rennen stört.
   - Rollen weiterhin verzögert laden, aber `loading` zuverlässig beenden, auch wenn Rollenabfrage fehlschlägt.

4. `src/routes/forgot-password.tsx` Redirect stabilisieren
   - Statt der aktuell geöffneten Domain eine stabile App-URL verwenden, damit der Reset nicht zwischen Preview-/Published-/alter Lovableproject-Domain springt.
   - Für die aktuelle Vorschau wird der stabile Preview-Link verwendet; nach Veröffentlichung kann der Published-Link genutzt werden.
   - Die Hinweise auf der Seite bleiben, aber der Fehler liegt nicht mehr bei GMX oder zu langsamem Öffnen.

5. Danach Testablauf
   - Alten Reset-Link verwerfen.
   - Genau einen neuen Link anfordern.
   - Link öffnen: Erwartet wird direkt das Formular „Neues Passwort setzen“.
   - Passwort speichern: Danach wird man abgemeldet und kann sich mit dem neuen Passwort anmelden.

Wichtig: Es gibt aktuell keine eigene E-Mail-Domain im Projekt. Das ist für Zustellbarkeit langfristig sinnvoll, ist aber nicht die Ursache für „Mail kommt schnell, Link wird sofort als abgelaufen angezeigt“. Die unmittelbare Lösung ist die robuste Verarbeitung des Recovery-Links in der App.