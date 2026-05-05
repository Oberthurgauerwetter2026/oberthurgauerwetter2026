Die Logs zeigen: Die Reset-Mails werden technisch ausgelöst und der Link wird beim Öffnen als Login/Recovery-Flow akzeptiert. Dass er danach trotzdem als „nicht mehr gültig“ erscheint, liegt sehr wahrscheinlich daran, dass der temporäre Recovery-Login nicht zuverlässig in der App-Session landet bzw. durch Weiterleitungen/Mehrfachaufrufe sofort verbraucht wird. Zusätzlich ist keine eigene E-Mail-Domain eingerichtet, was die Zustellung und das Vertrauen bei GMX verschlechtert.

Plan zur endgültigen Lösung:

1. Recovery-Flow in der App robuster machen
   - Die Reset-Seite verarbeitet aktuell nur indirekt, ob eine Session entstanden ist.
   - Ich werde die Seite so umbauen, dass sie Hash- und Query-Parameter des Recovery-Links aktiv auswertet.
   - Falls ein `code`-Parameter ankommt, wird dieser explizit gegen eine Session eingetauscht.
   - Falls `access_token`/`refresh_token` im Link ankommen, wird die Session explizit gesetzt.
   - Danach werden Token aus der URL entfernt, damit Browser-Reloads oder Vorschau-Parameter den Link nicht erneut verbrauchen.

2. Nicht automatisch zur App weiterleiten, solange Passwort-Reset läuft
   - Der globale Auth-Provider sieht den Recovery-Link aktuell als normalen Login.
   - Ich werde verhindern, dass der Recovery-Flow durch Login-/Dashboard-Logik oder Rollenladen gestört wird.
   - Während `/reset-password` aktiv ist, bleibt der Nutzer auf der Reset-Seite, bis das neue Passwort gespeichert wurde.

3. Reset-Link-Anforderung auf die stabile Projekt-URL korrigieren
   - Aktuell werden Links auf die jeweilige Vorschau-/Projekt-URL erzeugt.
   - Ich werde den Redirect möglichst auf die stabile veröffentlichte URL des Projekts setzen, damit der Link nicht durch wechselnde Preview-Parameter oder Editor-URLs beeinflusst wird.
   - In der lokalen Vorschau bleibt die aktuelle Origin nutzbar, aber produktiv soll der stabile Link verwendet werden.

4. Fehlermeldungen und Bedienung verbessern
   - Die Reset-Seite bekommt klare Zustände:
     - „Link wird geprüft“
     - „Passwort kann gesetzt werden“
     - „Link abgelaufen oder bereits verwendet“
   - Bei ungültigem Link wird nicht nur blockiert, sondern direkt ein Button für einen neuen Link angeboten.
   - Die Seite erklärt, dass immer nur der neueste Reset-Link verwendet werden darf.

5. Datenbank-/Trigger-Reparatur sauber nachziehen
   - Die bestehende Migration versucht, einen Trigger auf neue Nutzer zu setzen, aber der aktuelle Backend-Zustand zeigt noch keinen Trigger.
   - Ich werde per Migration sicherstellen, dass Profil-Erstellung und Rollenlogik für neue Benutzer zuverlässig aktiv sind.
   - Rollen bleiben weiterhin in der separaten Rollen-Tabelle.

6. E-Mail-Domain einrichten
   - Derzeit ist keine eigene E-Mail-Domain konfiguriert.
   - Für zuverlässige GMX-Zustellung sollte eine eigene Absenderdomain eingerichtet werden, z. B. `mail.oberthurgauerwetter.ch` oder `noreply.oberthurgauerwetter.ch`.
   - Danach werden die Passwort-Reset- und Bestätigungsmails über diese Domain verschickt.

Nach Umsetzung gilt für dich:
1. Alle alten Reset-Mails löschen.
2. Genau einen neuen Reset-Link anfordern.
3. 1–2 Minuten warten und nur die neueste Mail öffnen.
4. Link genau einmal öffnen.
5. Passwort setzen und danach normal einloggen.

Technische Details:
- Betroffene Dateien: `src/routes/reset-password.tsx`, `src/routes/forgot-password.tsx`, ggf. `src/hooks/use-auth.tsx` und eine neue Backend-Migration.
- Es werden keine Rollen im Profil gespeichert.
- Die Auth-E-Mail-Domain muss über Lovable Cloud eingerichtet werden; dafür öffne ich nach Freigabe den Domain-Setup-Schritt.