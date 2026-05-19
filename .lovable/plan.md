# Plan: GitHub-Workflow-Logs gezielt analysieren

## Ziel

Die Ursache des weiterhin fehlschlagenden GitHub-Workflows soll nicht mehr geraten, sondern anhand des vollständigen Logs eindeutig bestimmt werden.

## Was ich brauche

Bitte den kompletten Log des fehlgeschlagenen GitHub-Schritts kopieren:

```text
Actions → Generate pressure map → fehlgeschlagener Run → Job generate → Schritt "Generate and upload map"
```

Wichtig sind besonders die Zeilen direkt vor:

```text
Process completed with exit code ...
```

Falls dort neue Phasenlogs stehen, bitte alles ab der ersten Zeile mit `[phase:` oder `[OM]` bis zum Ende des Schritts mitschicken.

## Analyse-Schritte

1. Den tatsächlichen Fehlerblock aus dem Schritt **Generate and upload map** identifizieren.
2. Prüfen, ob der Fehler aus Secrets, Open-Meteo-Daten, SVG-Erzeugung oder Upload kommt.
3. Nur die konkret betroffene Stelle ändern, statt den Workflow erneut breit umzubauen.
4. Danach eine kurze Testanweisung für einen manuellen GitHub-Run geben.

## Mögliche Ergebnisse

- Fehlende oder falsch benannte Repository-Secrets.
- Open-Meteo liefert für den Zielzeitpunkt zu wenige Druckwerte.
- Upload in den Speicher-Bucket schlägt fehl.
- Die GitHub-Seite führt noch einen alten Commit aus, in dem die letzten Änderungen noch nicht enthalten sind.

## Kein Code-Änderungsschritt ohne Log

Ich nehme erst wieder Code-Änderungen vor, wenn der vollständige Fehlerlog die Ursache zeigt.
