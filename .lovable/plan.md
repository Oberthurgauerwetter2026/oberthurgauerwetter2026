# Plan: Service-Role-Key sicher per Base64 nach GitHub bringen

## Problem

Beim Einfügen des Service-Role-Keys ins GitHub-Secret-Feld passt der Wert nur mit Zeilenumbruch hinein — und genau dieser Umbruch landet im Header und führt zu `Headers.set: invalid header value`. Der bereits eingebaute Whitespace-Filter würde das zwar abfangen, aber wir wollen das Problem an der Quelle vermeiden, damit nichts Unsichtbares (z. B. Non-Breaking-Spaces, Word-„Smart Quotes") durchrutscht.

## Lösung: zweiter Secret-Slot in Base64

Wir erlauben dem Generator, den Key wahlweise aus einer Base64-Variante zu lesen. Base64 enthält nur ASCII-Buchstaben/Zahlen + `+ /  =`, hat keine Zeilenumbrüche und ist beim Kopieren harmlos.

### Code-Änderung in `pressure-map-generator/generate.mjs`

In der `env-check`-Phase zusätzlich `SUPABASE_SERVICE_ROLE_KEY_B64` lesen:

- Wenn gesetzt → mit `Buffer.from(value, "base64").toString("utf8")` dekodieren und das Ergebnis als Service-Key verwenden.
- Sonst → wie bisher `SUPABASE_SERVICE_ROLE_KEY` (mit Whitespace-Filter).

Anschließend wie gehabt prüfen: nicht leer, nur ASCII, gültige Länge loggen.

### Workflow-Datei `.github/workflows/pressure-map.yml`

Im `env:`-Block zusätzlich `SUPABASE_SERVICE_ROLE_KEY_B64: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY_B64 }}` durchreichen. Der alte Eintrag bleibt als Fallback bestehen.

## Aktion vom Nutzer

1. Den Service-Role-Key einmal lokal in Base64 verpacken. Auf macOS:

   ```bash
   printf %s 'DEIN_LANGER_JWT_KEY' | base64
   ```

   (Wichtig: `printf %s`, damit kein Newline angehängt wird. Bei Windows PowerShell:
   `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('DEIN_KEY'))`.)

2. Das Ergebnis als neues GitHub-Secret `SUPABASE_SERVICE_ROLE_KEY_B64` anlegen (Repository → Settings → Secrets and variables → Actions → New repository secret). Der Base64-String ist eine einzige Zeile ohne Sonderzeichen, das Einfügen ist problemlos.

3. Workflow `Generate pressure map` manuell starten. Erwartetes Log:

   ```text
   [gen] using base64-encoded service key
   [gen] phase=upload (...)
   uploaded europe-pressure-latest.svg
   ```

Den alten Secret `SUPABASE_SERVICE_ROLE_KEY` brauchst du dann nicht mehr — kannst ihn aber für später drinlassen.
