## Passwort direkt in der Datenbank setzen

Für `br.rutishauser@gmx.ch` wird das Passwort auf `Platten.1983` gesetzt, die E-Mail bestätigt (falls noch nicht) und alle alten Recovery-Tokens werden gelöscht.

### SQL (wird über die Datenbank-Tool-Operation ausgeführt)

```sql
update auth.users
set
  encrypted_password = crypt('Platten.1983', gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  recovery_token = '',
  recovery_sent_at = null,
  updated_at = now()
where email = 'br.rutishauser@gmx.ch';
```

### Danach

1. `/login` öffnen
2. E-Mail: `br.rutishauser@gmx.ch`
3. Passwort: `Platten.1983`
4. **Sofort nach dem Login** das Passwort in der App ändern (Profil/Einstellungen) — du hast es im Chat geteilt.

### Code-Änderungen

Keine. Nur eine Daten-Operation auf `auth.users`.
