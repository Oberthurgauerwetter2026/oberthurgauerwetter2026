Ich habe die aktuellen Logs und den Code geprüft. Der Login schlägt aktuell nicht wegen einer allgemeinen App-Störung fehl, sondern weil das eingegebene Passwort nicht zum bestehenden Konto passt. Der Reset ist zusätzlich instabil, weil der Recovery-Link zwar eine temporäre Session erzeugt, die Seite aber diese Session noch nicht robust genug verarbeitet und der Reset-Link mehrfach/zu schnell neu angefordert wurde. Außerdem ist noch keine eigene E-Mail-Domain eingerichtet, wodurch GMX die Standard-Mails eher filtern oder verzögern kann.

Plan zur Lösung:

1. Passwort-Reset-Seite robust machen
   - In `src/routes/reset-password.tsx` die Recovery-Token-Verarbeitung explizit absichern.
   - Beim Laden der Seite sofort prüfen, ob der Link Hash-Parameter oder Query-Parameter für einen Recovery-Flow enthält.
   - Nicht nur pauschal auf irgendeine vorhandene Session reagieren, sondern den Recovery-Zustand sauber setzen.
   - Bei `Auth session missing` eine klare deutsche Meldung anzeigen: Link abgelaufen/bereits verwendet, bitte neuen Link anfordern.
   - Nach erfolgreichem Passwortwechsel Session sauber beenden und zurück zum Login führen.

2. Reset-Link-Anforderung benutzerfreundlicher machen
   - In `src/routes/forgot-password.tsx` die Rate-Limit-Fehler verständlich übersetzen, statt die technische Meldung anzuzeigen.
   - Nach erfolgreichem Senden den Button vorübergehend sperren bzw. Hinweise anzeigen, damit nicht mehrfach hintereinander Reset-Mails ausgelöst werden.
   - Deutlich anzeigen: einige Minuten warten, Spam prüfen, Link nur einmal öffnen.

3. Login-Fehlermeldung verständlich machen
   - In `src/routes/login.tsx` `Invalid login credentials` auf Deutsch übersetzen.
   - Direkt auf den sicheren Weg verweisen: „Passwort vergessen?“ statt weiter mehrfach falsche Passwörter zu probieren.

4. Auth-Session-Hook stabilisieren
   - In `src/hooks/use-auth.tsx` die Ladezustände sauberer setzen, auch wenn Rollen geladen werden oder fehlschlagen.
   - Rollen nur nach vollständig wiederhergestellter Session laden.
   - Damit vermeiden wir Race Conditions nach Login/Reset und hängende Ladezustände.

5. Daten-/Rollen-Situation prüfen und bei Bedarf reparieren
   - Aktuell gibt es eine Admin-Rolle für dein Konto, aber keine passende Profilzeile. Das ist ein Inkonsistenzzeichen.
   - Ich werde per sicherer Migration/Backend-Reparatur eine fehlende Profilzeile für bestehende Benutzer nachziehen und den Signup-Trigger wieder korrekt sicherstellen, damit zukünftige Konten konsistent angelegt werden.
   - Rollen bleiben wie vorgeschrieben in der separaten Rollentabelle.

6. E-Mail-Zustellung nachhaltig lösen
   - Kurzfristig: neue Reset-Mail erst nach Ablauf des Limits anfordern und GMX Spam/Junk prüfen.
   - Dauerhaft: eine eigene Absender-Domain in Lovable Cloud einrichten, z. B. eine Subdomain deiner Wetter-Domain. Danach kommen Reset- und Bestätigungsmails zuverlässiger und mit deinem Absender an.

Nach Umsetzung solltest du so vorgehen:
1. Auf „Passwort vergessen?“ klicken.
2. Reset-Link genau einmal öffnen.
3. Neues Passwort setzen.
4. Danach mit diesem neuen Passwort einloggen.

Wichtig: Wenn der Link vorher schon geöffnet wurde oder der Browser ihn mehrfach geladen hat, muss ein neuer Reset-Link angefordert werden.