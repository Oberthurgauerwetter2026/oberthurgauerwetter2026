# Diagnose: R2-Cache läuft nicht

Auf dem Screenshot fällt auf, dass das Repo **`amriswil-wetter`** leer aussieht (keine Sprache, kein Commit-Graph). Der Workflow `openmeteo-ingest.yml` und das Script liegen aber im **Lovable-Repo `oberthurgauerwetter2026`** — also dort muss er auch laufen. Möglich sind drei Ursachen, die ich der Reihe nach prüfe und löse:

## Mögliche Ursachen

1. **Workflow wurde noch nie ausgeführt** — Cron `*/5 * * * *` startet bei GitHub erst nach dem ersten manuellen Run zuverlässig. Ergebnis: R2 ist leer, Worker hat nichts zum Lesen.
2. **R2-Secret-Mismatch** — `R2_BUCKET` zeigt vermutlich auf `amriswil-wetter`, aber der Public-Access-Hostname (`R2_PUBLIC_URL`) gehört zu einem anderen Bucket oder hat noch keinen `pub-…r2.dev`-Domain bekommen.
3. **Pfad/Key-Mismatch** — Script schreibt `openmeteo/forecast.json`, Worker liest `${R2_PUBLIC_URL}/openmeteo/forecast.json`. Wenn `R2_PUBLIC_URL` mit `/` endet oder den Bucket-Namen schon im Pfad enthält, kommt 404.

## Schritte (in dieser Reihenfolge)

### 1. R2-Endpoint von Worker-Seite aus prüfen
Kurzen Server-Endpoint `/api/public/debug/r2-cache` (GET) anlegen, der:
- `R2_PUBLIC_URL` aus `process.env` liest (Wert maskiert ausgibt: Host + erste 8 Zeichen),
- `${R2_PUBLIC_URL}/openmeteo/forecast.json` fetched,
- HTTP-Status, Content-Length, `generatedAt` und Alter (Minuten) zurückgibt.

Dann via `stack_modern--invoke-server-function` aufrufen → wir wissen sofort, ob der Bucket befüllt ist und ob die URL stimmt.

### 2. Je nach Ergebnis
- **404 / leerer Bucket** → Workflow wurde nie getriggert. Ich gebe dir den genauen URL-Link „Run workflow" + erkläre kurz, wie du das tust (Actions-Tab → "Open-Meteo Cache Ingest" → "Run workflow"). Dieses Plan-Tool darf ich keine GitHub-Calls auslösen.
- **403 / CORS / "not authorized"** → Bucket-Public-Access nicht aktiv ODER `R2_PUBLIC_URL` zeigt auf falschen Bucket. Ich beschreibe genau, was in Cloudflare anzupassen ist.
- **200 + altes `generatedAt`** → Workflow hat einmal geschrieben, läuft aber nicht mehr. Cron-Status in GitHub Actions prüfen.
- **200 + frisch** → R2 ok, Fallback-Code im Worker hat ein Bug. Dann fixe ich `openmeteo-cache.server.ts` / `openmeteo-quota.server.ts` direkt.

### 3. Aufräumen
Den Debug-Endpoint entferne ich am Ende wieder (oder lasse ihn als Admin-Hilfe stehen, je nach Wunsch).

## Technische Details

- Datei neu: `src/routes/api/public/debug/r2-cache.ts` (TanStack server route, keine Auth, nur GET, gibt JSON zurück).
- Maskiert ausgegebene Werte: Host bleibt sichtbar, kein Token im Spiel (R2 ist public read).
- Keine DB-Änderung, kein Secret-Change nötig.

## Nicht im Scope

- Workflow-Run kann ich nicht selbst auslösen (kein GitHub-Tool im Sandbox).
- Cloudflare-Bucket-Einstellungen kann ich nicht ändern.

Sobald du den Plan freigibst, baue ich den Debug-Endpoint, rufe ihn auf und sage dir das Ergebnis im nächsten Schritt.