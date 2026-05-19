# Workflow läuft auf alter GitHub-Version — Sync prüfen

## Befund

Im Lovable-Projekt ist die Workflow-Datei `.github/workflows/pressure-map.yml`
bereits korrekt: die ungültige Zeile `package-manager-cache: false` ist raus
(verifiziert mit `rg` — 0 Treffer).

Aktueller Inhalt der Datei in Lovable:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "20"
    registry-url: "https://registry.npmjs.org"
```

Trotzdem zeigt GitHub Actions weiterhin exakt:

> Unexpected input(s) 'package-manager-cache'

Das ist nur möglich, wenn GitHub eine **ältere Version** der Datei ausführt.

## Ursache (drei mögliche)

1. Lovable hat die Änderung noch nicht zu GitHub gepusht (Sync hängt /
   ist langsam / GitHub-Connection unterbrochen).
2. Du schaust im GitHub-UI auf einen **alten Run** (vor dem Fix). Alte Runs
   ändern sich nicht — sie zeigen für immer den Fehler des damaligen Codes.
3. „Run workflow" wurde auf einem alten Branch oder einem alten Commit-SHA
   gestartet.

## Was zu tun ist (du, im GitHub-UI)

### Schritt 1 — Sync prüfen
Öffne dein GitHub-Repo und gehe zu `.github/workflows/pressure-map.yml`.
Bestätige: enthält die Datei dort die Zeile `package-manager-cache: false`?

- **Ja → Sync-Problem.** In Lovable oben rechts auf GitHub-Status klicken,
  „Sync" / „Push" auslösen, ggf. die GitHub-Integration neu verbinden.
- **Nein → Schritt 2.**

### Schritt 2 — Neuen Run starten (nicht alten ansehen)
1. Im Repo auf `Actions` → links `Generate pressure map`.
2. Rechts `Run workflow` → Branch `main` (Default) → `Run workflow`.
3. **Den neu entstehenden Run** öffnen (oberster, mit aktueller Uhrzeit) —
   nicht einen früheren.

### Schritt 3 — Falls neue Meldung
Wenn der neue Run jetzt eine andere Meldung zeigt (z.B. zu Secrets, Upload
oder „exit code 99" aus `generate.mjs`), screenshot davon machen — das ist
dann ein separates Problem, das ich gezielt fixen kann.

## Was ich in Lovable NICHT mehr ändern muss

Code, Workflow und `package-lock.json` sind in Ordnung. Verifiziert:
- `node --check pressure-map-generator/generate.mjs` → ok
- Storage-Bucket `weather-maps` existiert und ist public
- `app_settings.pressure_map_last_run` / `_last_status` Spalten existieren
- `package-manager-cache` ist in der Workflow-Datei nicht mehr enthalten

Es gibt aktuell nichts Sinnvolles, das ich am Code ändern könnte, das die
GitHub-Meldung verändern würde — die liegt zu 100% am Sync/Run-Stand.
