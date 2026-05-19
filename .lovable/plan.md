## Plan: GitHub Workflow weiterhin „gleiche Meldung“ beheben

### Ziel
Der GitHub Action Workflow `Generate pressure map` soll zuverlässig durchlaufen, ohne an Node/npm-Setup oder fehlendem Lockfile zu scheitern.

### Diagnose
- Die Workflow-Datei enthält inzwischen kein `setup-node`-Caching mehr.
- Im Ordner `pressure-map-generator/` fehlt weiterhin `package-lock.json`.
- Wenn GitHub noch dieselbe Lockfile-/Cache-Meldung zeigt, ist entweder die Änderung noch nicht bei GitHub angekommen oder die robustere Lösung ist, das erwartete Lockfile einzuchecken.

### Umsetzung
1. In `pressure-map-generator/` ein `package-lock.json` aus `package.json` erzeugen.
2. Keine Secrets ändern.
3. Keine App-UI ändern.
4. Danach den Workflow erneut manuell starten.

### Erwartetes Ergebnis
GitHub Actions kann die Dependencies eindeutig installieren und der Workflow kommt zum eigentlichen Schritt `Generate and upload map` weiter.
