## Plan: GitHub Action endgültig vom npm-/Cache-Fehler befreien

### Ziel
Der Workflow `Generate pressure map` soll auf GitHub unabhängig von Lovable-internen npm-Einstellungen installieren und bis zum Schritt `Generate and upload map` weiterlaufen.

### Aktuelles Problem
- Die Workflow-Datei nutzt zwar kein explizites `setup-node`-Caching mehr.
- Das neu erzeugte `pressure-map-generator/package-lock.json` enthält aber Download-URLs aus einem Lovable-internen npm-Cache.
- GitHub Actions kann diese internen URLs nicht zuverlässig abrufen. Dadurch kann der Fehler trotz Lockfile weiter wie ein npm-/Cache-/Dependency-Problem aussehen.

### Umsetzung
1. Das Lockfile im Generator so neu erzeugen, dass alle Pakete auf die öffentliche npm-Registry zeigen.
2. Den Workflow zusätzlich explizit gegen automatisches `setup-node` Package-Manager-Caching absichern.
3. Die Installation im Workflow auf die öffentliche npm-Registry festnageln und dann mit dem Lockfile installieren.
4. Keine App-UI ändern und keine Secrets ändern.

### Erwartetes Ergebnis
GitHub Actions verwendet keine Lovable-internen npm-Cache-URLs mehr und kann die Generator-Abhängigkeiten sauber installieren.

### Danach
Nach dem Sync zu GitHub den Workflow manuell erneut starten. Falls er dann weiterkommt und an Secrets scheitert, ist das ein separater Fehler bei den GitHub Repository Secrets.
