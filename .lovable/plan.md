# Fix-Plan: GitHub Action Warnung + Exit Code 99

## Befund

Die neue Meldung besteht aus zwei getrennten Themen:

1. **Warnung:** `actions/checkout@v4` und `actions/setup-node@v4` laufen noch auf der GitHub-internen Node-20-Runtime. Das ist eine Deprecation-Warnung der Action selbst, nicht des Generators.
2. **Fehler:** `Process completed with exit code 99` kommt aus `pressure-map-generator/generate.mjs` ganz am Ende:

```js
main().catch((e) => { console.error(e); process.exit(99); });
```

Das bedeutet: irgendwo in `main()` wird eine Exception geworfen, aber der aktuelle Log sagt nicht sauber, in welcher Phase.

## Geplanter Fix

### 1. Workflow auf Node-24-kompatible Actions vorbereiten

In `.github/workflows/pressure-map.yml`:

- `actions/checkout` auf die aktuelle Node-24-kompatible Major-Version aktualisieren, falls verfügbar.
- `actions/setup-node` auf die aktuelle Node-24-kompatible Major-Version aktualisieren, falls verfügbar.
- Zusätzlich `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` im Job setzen, damit GitHub die neue Runtime jetzt schon verwendet.
- Die Generator-Node-Version für `node generate.mjs` vorerst auf Node 20 lassen, weil die Dependencies aktuell `node >=20` verlangen und der eigentliche Generator damit kompatibel ist.

### 2. Generator-Fehler sichtbar machen

In `pressure-map-generator/generate.mjs`:

- Jede Hauptphase klar loggen: Env-Check, Client-Erstellung, Wetterdaten-Fetch, SVG-Build, Upload, Status-Update.
- Vor `createClient` `SUPABASE_URL` validieren, ohne Secrets auszugeben.
- Bei unerwarteten Fehlern Stacktrace und Phase ausgeben, damit GitHub nicht nur `exit code 99` zeigt.
- Exit Codes vereinheitlichen, damit Fehler unterscheidbar sind:
  - `1` fehlende/ungültige Secrets
  - `2` zu wenige Wetterdaten
  - `3` Upload fehlgeschlagen
  - `4` SVG-Erzeugung fehlgeschlagen
  - `99` nur noch echter unbekannter Fallback

### 3. Robustheit gegen Open-Meteo-Ausfälle verbessern

- Wenn ein Open-Meteo-Batch kein passendes Ziel-Zeitfenster enthält, zusätzlich verfügbare Zeiten im Log nennen.
- Bei zu wenigen gültigen Druckwerten den zuletzt getesteten Modellnamen und Zieltermin loggen.
- Keine sensiblen Schlüssel ausgeben.

## Ergebnis nach Umsetzung

Der nächste GitHub-Run sollte entweder erfolgreich durchlaufen oder eine konkrete Ursache zeigen, z.B. ungültige Repository-Secrets, Open-Meteo-Datenlücke, SVG-Fehler oder Upload-Fehler. Die Node-20-Action-Warnung sollte ebenfalls verschwinden oder deutlich reduziert sein.

## Danach testen

Nach der Änderung im GitHub-UI einen neuen manuellen Run starten:

```text
Actions → Generate pressure map → Run workflow → Branch main
```

Falls der Run dann noch fehlschlägt, reicht der vollständige Log des Schritts **Generate and upload map**; dann ist die Ursache eindeutig sichtbar.
