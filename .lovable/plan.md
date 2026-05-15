# Plan — Bodendruckkarte wieder zuverlässig generieren

## Befund

- Die Cron-Jobs laufen: heute um 04:15, 06:15, 09:15 und 13:15 UTC wurden Requests ausgelöst.
- Die Karte selbst ist aber alt: `europe-pressure-latest.svg` wurde zuletzt am 12.05. aktualisiert.
- Die letzten HTTP-Antworten waren `429` mit: `Pausiert: Open-Meteo Tageslimit erreicht (auto-retry 00:00 UTC)`.
- In der Datenbank liegt ein aktiver Rate-Limit-Marker `om:ratelimit:pressure-map` bis 16.05. 00:00 UTC.
- Auffällig: Der aktuell im Code vorhandene Self-Heal würde diesen Marker bei niedriger Nutzung entfernen. Die Antworttexte kommen aber noch aus einer älteren veröffentlichten Version. Der Cron ruft die veröffentlichte URL auf, nicht die Preview-Version.

## Wahrscheinliche Ursache

Die Druckkarten-Cronjobs treffen noch auf die alte veröffentlichte Backend-Route. Dort blockiert ein als „daily limit” klassifizierter Marker alle Folgeversuche bis Mitternacht. Dadurch wird trotz laufendem Cron keine neue Karte erzeugt.

## Umsetzung

1. **Sofort entsperren**
   - Den aktiven Marker `om:ratelimit:pressure-map` löschen.
   - Den Druckkarten-Status auf „entsperrt / nächster Lauf möglich” setzen.

2. **Route robuster machen**
   - Statusmeldungen eindeutig versionieren, damit man sofort sieht, ob Cron Preview/aktuellen Code oder eine alte veröffentlichte Route trifft.
   - Bei `daily`-Marker plus sehr niedriger gemessener Nutzung den Marker sicher löschen und weitergenerieren.
   - Bei transienten Minutely/Burst-Limits keinen Tages-Pausenmarker setzen.

3. **Cron-Ziel absichern**
   - Prüfen, ob die Jobs weiterhin die veröffentlichte URL verwenden sollen.
   - Nach dem Fix muss die App veröffentlicht werden, weil Cron aktuell gegen die veröffentlichte Route läuft.

4. **Verifikation**
   - Cron/HTTP-Response prüfen: kein 429-Pausenstatus mehr.
   - Storage-Objekt prüfen: `europe-pressure-latest.svg` bekommt ein neues `updated_at`.
   - Status in den Einstellungen zeigt „OK” mit neuem Zieltermin und Quelle.

## Ergebnis

Die Karte soll nicht mehr tagelang durch einen alten/stale Rate-Limit-Marker blockiert werden, und künftige Fehler zeigen klar, ob Cron, Open-Meteo oder eine nicht veröffentlichte Codeversion die Ursache ist.
