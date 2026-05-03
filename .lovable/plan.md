## Ziel
Den User `br.rutishauser@gmx.ch` als bestätigten Admin im Backend anlegen.

## Vorgehen
Der User existiert noch nicht in der Datenbank. Ich lege ihn direkt im Auth-System an (mit bestätigter E-Mail) und weise ihm die Admin-Rolle zu.

### Schritte
1. **User erstellen** via `supabaseAdmin.auth.admin.createUser`:
   - E-Mail: `br.rutishauser@gmx.ch`
   - Temporäres Passwort (wird generiert, dem User mitgeteilt)
   - `email_confirm: true`, damit direkt einloggbar
   - Der bestehende DB-Trigger `handle_new_user_with_first_admin` legt automatisch das Profil an
2. **Admin-Rolle zuweisen**: Eintrag in `public.user_roles` mit `role = 'admin'` für die neue user_id (per Migration/Insert).
3. **Anmeldedaten zurückmelden**: Ich teile das initiale Passwort im Chat mit, damit sich der User einloggen und es im Profil ändern kann.

## Offene Frage
Soll ich ein **zufälliges Initial-Passwort** generieren und im Chat ausgeben, oder hast du ein gewünschtes Passwort, das ich verwenden soll? (Default ohne Antwort: zufälliges Passwort.)
