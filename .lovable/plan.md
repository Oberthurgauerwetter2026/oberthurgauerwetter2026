## Diagnose

Heute 06:00 UTC: Cron lief, **0 von 1316 Gitterpunkten** wurden geliefert. Open-Meteo antwortete für jeden der 27 Druckkarten-Batches mit `429 — Daily API request limit exceeded.` Die Druckkarte ist heute nicht mehr generierbar (frühestens morgen, wenn Open-Meteo das Tageslimit zurücksetzt).

Strukturelle Ursache: Druckkarte (~27 OM-Calls) + Forecast-Generierung teilen sich denselben Lovable-Cloud-IP-Pool und damit dasselbe tägliche Open-Meteo-Limit. Wenn der Forecast vorher viele Calls verbraucht, fällt die Karte über die Grenze (oder umgekehrt).

## Änderungen

### 1. Grid-Auflösung reduzieren (1.5° → 2.0°)

`src/server/pressure-map.server.ts`:
- `STEP = 1.5` → `STEP = 2.0`
- Kommentare/Berechnungen für `COLS`/`ROWS` aktualisieren: 36 × 21 = **756 Gitterpunkte** statt 1316.
- Mit `BATCH = 50` ergibt das **16 Batches** statt 27 → ~40 % weniger Open-Meteo-Calls.
- Visuell: Isobaren bleiben durch Chaikin-Glättung + Catmull-Rom-Bezier praktisch identisch lesbar; nur sehr lokale Druckfeinheiten (z. B. kleine Hochs zwischen Alpenpässen) verschwinden.
- Schwelle `validCount < 100` bleibt (entspricht jetzt ~13 % statt ~7,6 % — robust genug).

### 2. Cron-Slot von 06:00 UTC auf 03:00 UTC vorziehen

Über Insert-Tool (kein Migration, da userspezifische URL/Key):

```sql
SELECT cron.unschedule('generate-pressure-map-daily');

SELECT cron.schedule(
  'generate-pressure-map-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--e38eb7cd-9a65-493a-b3eb-f8b0eb5a851d.lovable.app/api/public/hooks/generate-pressure-map',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','<ANON_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Damit läuft die Karte **vor** der Forecast-Generierung (~03:28 UTC). Karten verbrauchen dann nur noch ~16 Calls aus dem frischen Tagesbudget; der Forecast hat anschließend praktisch das volle Open-Meteo-Limit zur Verfügung.

### 3. Statusmeldung aktualisieren

In `pickTargetTime` und im Skip-Check nichts ändern — bleibt „Tomorrow 12:00 UTC". Die Karte gilt also weiterhin für den Mittagsdruck des Folgetags.

## Was bleibt unverändert

- Stable Storage-URL `weather-maps/europe-pressure-latest.svg` — Einbettung in WordPress muss nicht angepasst werden.
- Idempotency-Skip (gleicher Tag + OK-Status → kein Doppellauf).
- Rate-Limit-Marker / Auto-Heal in `OpenMeteoUsageCard` (heute morgen eingebaut).
- Forecast-Logik, MOSMIX, Bias-Korrektur, alles andere.

## Erwartetes Ergebnis

- **Heute (13. Mai)**: Keine neue Karte möglich, Open-Meteo-Tageslimit ist erschöpft. Letzte Karte von gestern bleibt unter dem stabilen Link sichtbar.
- **Ab morgen 03:00 UTC**: Karte erscheint zuverlässig vor der Forecast-Generierung. Etwa 40 % weniger Open-Meteo-Calls pro Lauf → Forecast bekommt sicher sein Kontingent.
- **Karten-Optik**: praktisch unverändert; nur sehr feine lokale Druckdetails leicht weichgezeichnet.
