# LOVABLE_API_KEY auf Reveal-Seite anzeigen

Erweitere die existierende Admin-Reveal-Seite, damit der maskierte
`LOVABLE_API_KEY` einmalig im Klartext abgegriffen werden kann (für das
GitHub-Repo-Secret der Pressure-Map-Action).

## Änderungen

1. `src/lib/reveal-key.functions.ts`
   - Antwort zusätzlich um `lovableApiKey: process.env.LOVABLE_API_KEY ?? ""` erweitern.
   - `debug`-Block ergänzt um `hasLovableKey` und `lovableKeyLength`.
   - Admin-Check und `requireSupabaseAuth`-Middleware bleiben unverändert.

2. `src/routes/_app.admin.reveal-key.tsx`
   - Im Ergebnis-Block zusätzliches Read-only-Textarea-Feld „LOVABLE_API_KEY".
   - Typ des `data`-State um `lovableApiKey: string` ergänzt.
   - Hinweistext angepasst: jetzt drei Secrets in GitHub eintragen.

## Nutzung

- `/admin/reveal-key` öffnen (als Admin eingeloggt) → „Schlüssel anzeigen"
- LOVABLE_API_KEY kopieren → GitHub → Repo Settings → Secrets and variables
  → Actions → `LOVABLE_API_KEY` als Repository Secret eintragen.

Keine neuen Dateien, keine DB-Änderungen, keine neuen Secrets.
