## Problem

Auf `/reset-password` erscheint **"Auth session missing!"**, wenn `supabase.auth.updateUser({ password })` aufgerufen wird, ohne dass eine gültige Recovery-Session existiert.

Ursachen aus den Logs:
- Der Recovery-Link wurde mehrfach geklickt (Token nur 1× gültig).
- Die aktuelle `reset-password.tsx` wartet **nicht** auf das `PASSWORD_RECOVERY`-Event von Supabase und prüft die Session vor dem Submit nicht.
- Wird die Seite direkt (ohne frischen Recovery-Token) geöffnet, gibt es keine Session → `updateUser` schlägt fehl.

## Lösung

`src/routes/reset-password.tsx` umbauen, sodass die Seite:

1. Beim Mount auf `onAuthStateChange` hört und auf `PASSWORD_RECOVERY` wartet.
2. Zusätzlich `supabase.auth.getSession()` prüft (Hash-Token wird automatisch konsumiert).
3. Drei klare Zustände rendert:
   - **Loading** – während Session-Check läuft.
   - **Kein Recovery-Token** – Hinweis + Button „Neuen Link anfordern" → `/forgot-password`.
   - **Bereit** – Formular freigeschaltet.
4. Submit-Button ist disabled, solange keine Recovery-Session existiert.
5. Nach erfolgreichem `updateUser`: `supabase.auth.signOut()` + Redirect auf `/login` mit Toast „Bitte mit neuem Passwort anmelden".

Zusätzlich in `forgot-password.tsx` einen Hinweis: „Den Link nur **einmal** anklicken — bei Mehrfachklick wird er ungültig."

## Was der User jetzt sofort tun kann

1. Auf `/forgot-password` einen **neuen** Reset-Link anfordern.
2. Spam-Ordner bei GMX prüfen.
3. Den Link in der E-Mail **nur einmal** anklicken.
4. Direkt auf der geöffneten Seite das neue Passwort setzen.
5. Anschließend auf `/login` mit dem neuen Passwort einloggen.

## Geänderte Dateien

- `src/routes/reset-password.tsx` (Hauptfix)
- `src/routes/forgot-password.tsx` (kleiner Hinweistext)

Keine Datenbank- oder Auth-Konfig-Änderungen nötig.
