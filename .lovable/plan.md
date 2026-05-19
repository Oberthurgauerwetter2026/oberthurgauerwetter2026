# Plan: Upload-Fehler wegen Zeilenumbrüchen im Service-Role-Key

## Ursache

Der Generator kommt jetzt bis zum Upload. Dort scheitert er an:

```text
Headers.set: "***\n\n***" is an invalid header value.
```

Das heißt: Der Wert von `SUPABASE_SERVICE_ROLE_KEY` enthält Zeilenumbrüche. Die maskierte Form `***\n\n***` zeigt zwei maskierte Teile mit Newline dazwischen. Auch die Schlüssellänge 261 ist verdächtig — ein normaler Service-Role-JWT ist um die 220 Zeichen lang. HTTP-Header dürfen keine Zeilenumbrüche enthalten, deshalb bricht der Upload-Aufruf ab.

## Änderung im Code

In `pressure-map-generator/generate.mjs` direkt nach dem Einlesen der beiden Env-Variablen die Werte robust säubern:

- `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` mit `trim()` und Entfernen aller `\r` / `\n` im Inneren.
- Wenn nach dem Säubern noch immer ungültige Zeichen drin sind, mit Exit-Code 1 (Phase `env-check`) sauber abbrechen, statt erst im Upload zu scheitern.
- Beim Logging der Schlüssellänge zusätzlich angeben, ob der Key Whitespace enthielt — als klare Diagnose.

## Aktion vom Nutzer (parallel)

Im GitHub-Repository unter `Settings → Secrets and variables → Actions` den Secret `SUPABASE_SERVICE_ROLE_KEY` einmal komplett löschen und neu einfügen — als eine einzige Zeile, ohne Zeilenumbruch am Ende. Den Wert vorher in einem einfachen Editor (nicht Word/Pages) prüfen.

Der Service-Role-Key ist in Lovable Cloud unter `Backend → API Keys` zu finden.

## Test danach

Workflow `Generate pressure map` manuell starten (`Actions → Run workflow`). Erwartet: der Schritt durchläuft `phase=upload` ohne Fehler und meldet `uploaded europe-pressure-latest.svg`.
