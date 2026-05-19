# Fix GitHub Workflow: Ungültiger setup-node Input

## Problem

Der Workflow `pressure-map.yml` schlägt mit Exit Code 99 fehl. Der Screenshot zeigt die echte Ursache:

> Unexpected input(s) 'package-manager-cache', valid inputs are ['always-auth', 'node-version', 'node-version-file', 'architecture', 'check-latest', 'registry-url', 'scope', 'token', 'cache', 'cache-…']

`package-manager-cache` ist kein gültiger Input für `actions/setup-node@v4`. Ich hatte ihn in einer vorherigen Iteration fälschlich hinzugefügt, um den npm-Cache zu deaktivieren — aber der Cache ist sowieso standardmäßig aus, solange `cache:` nicht gesetzt wird.

## Fix

Eine Zeile aus `.github/workflows/pressure-map.yml` entfernen:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "20"
    registry-url: "https://registry.npmjs.org"
```

(Zeile `package-manager-cache: false` löschen.)

Keine weiteren Änderungen — `package-lock.json` und `npm ci` bleiben wie sie sind.
