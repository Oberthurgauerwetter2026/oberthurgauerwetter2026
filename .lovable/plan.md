Ich habe den Fehler eingegrenzt: Im Cache liegt aktuell `ens:v1:47.547,9.299` mit `payload.byDate = {}`. Das kommt daher, dass eine JavaScript-`Map` als JSON gespeichert wurde; beim Wiederlesen ist es kein `Map` mehr und `.get()` existiert nicht.

Plan zur Behebung:

1. `src/server/uncertainty.server.ts` JSON-sicher machen
   - `EnsembleData.byDate` von `Map<string, EnsembleDay>` auf `Record<string, EnsembleDay>` umstellen.
   - Beim Aufbau der Daten keine `Map` mehr speichern, sondern ein normales Objekt.
   - `.get()`, `.set()` und `.entries()` durch objektbasierte Zugriffe ersetzen.

2. Defensive Kompatibilität einbauen
   - In `formatUncertaintyHint` zuerst normalisieren:
     - falls doch noch eine `Map` ankommt: in Objekt umwandeln
     - falls ein Objekt ankommt: direkt verwenden
     - falls ungültige Struktur ankommt: `null` zurückgeben statt Crash
   - Dadurch bricht „Prognose öffnen“ auch bei alten oder unerwarteten Cache-Daten nicht mehr ab.

3. Cache-Version anheben
   - Cache-Key von `ens:v1:` auf `ens:v2:` ändern.
   - Damit wird der kaputte vorhandene Cache-Eintrag nicht mehr verwendet; es ist keine riskante Datenbank-Löschung nötig.

4. Optionaler Sofort-Fallback für kaputten alten Cache
   - Selbst wenn irgendwo noch `ens:v1` geladen würde, verhindert die defensive Normalisierung den Crash.

Keine UI-Änderung nötig. Nach der Umsetzung sollte „Prognose öffnen“ bzw. „Neu generieren“ nicht mehr mit `ensemble.byDate.get is not a function` abbrechen.