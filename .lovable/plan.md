## Änderung

In `src/server/pressure-map.server.ts`:

- Den dunklen Verlaufs-Hintergrund (`<linearGradient id="bg">` mit `#1a2332` → `#0f1620`) durch eine einfarbige Füllung **#2561a1** ersetzen.
- Titel- und Untertitel-Textfarben bleiben weiss/hell — passen weiterhin auf den blauen Hintergrund.
- Legenden-Beschriftung „Luftdruck (hPa)" bleibt weiss; die kleinen Zahlen (970/990/…) sind aktuell `#1f2937` und werden auf weiss gesetzt, damit sie auf #2561a1 lesbar bleiben.
