## Befund

- Der Cron-Job läuft: heute um 03:00 UTC wurde der Endpoint erfolgreich aufgerufen.
- Die Karte wurde nicht ersetzt, weil die Generierung mit `Zu wenige gültige Druckwerte (0/1344)` abgebrochen ist.
- Die vorhandenen Retry-Cronjobs aus der Migration sind aktuell nicht aktiv vorhanden; aktiv ist nur der tägliche 03:00-Job.
- Die Druckkarten-Logik ist zu strikt: Bei 0 gültigen Druckwerten wird komplett abgebrochen, obwohl eine letzte funktionierende Karte vorhanden ist und der Fehler als transient behandelt werden sollte.

## Plan

1. **Druckkarten-Fetch robuster machen**
  - In `src/server/pressure-map.server.ts` den Open-Meteo-Abruf so erweitern, dass bei leeren/ungültigen ICON-Daten automatisch ein alternatives globales Modell als Fallback versucht wird.
  - Ziel: nicht mehr bei `0/1344` abbrechen, wenn ein anderes Modell gültige Druckwerte liefern kann.
2. **Fallback-Strategie für Zielzeit verbessern**
  - Falls die Zielzeit `morgen 12:00 UTC` noch keine gültigen Werte liefert, zusätzlich nahe synoptische Zeiten prüfen, z. B. `morgen 06:00`, `morgen 18:00`, optional `heute 12:00` als letzte Rückfallebene.
  - Die Karte bleibt dadurch aktuell, statt komplett auszufallen.
3. **Statusmeldung präziser machen**
  - Den Status in `app_settings.pressure_map_last_status` so schreiben, dass klar erkennbar ist, ob die Karte direkt, über Modell-Fallback oder über Zeit-Fallback erstellt wurde.
  - Bei echten Ausfällen soll weiterhin ein verständlicher Fehlerstatus stehen.
4. **Cron-Retry wieder aktivieren**
  - Eine Datenbankänderung vorbereiten, die neben 03:00 UTC zusätzliche Retry-Slots einrichtet, z. B. 05:30, 07:30 und 10:30 UTC.
  - Der bestehende Idempotenz-Check verhindert Mehrfach-Erzeugung, sobald die Tageskarte einmal erfolgreich erstellt wurde.
5. **Verifikation**
  - Den Cron-Endpoint nach der Änderung mit gültigem Header testen.
  - Prüfen, dass `weather-maps/europe-pressure-latest.svg` ein neues `updated_at` erhält und der Status `OK` ist.
6.  - dabei  muss jedoch die Prognosengenerierung mit OpenMeteo gewährleistet bleiben