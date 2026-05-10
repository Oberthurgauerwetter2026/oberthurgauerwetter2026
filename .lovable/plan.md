## Diagnose

Der Fix ist im Code vorhanden, aber in der Datenbank liegen noch alte Rate-Limit-Marker von vor dem Fix:

- `om:ratelimit:meteoswiss_icon_ch1,meteoswiss_icon_ch2,meteofrance_arome_france_hd` läuft erst um `10:11 UTC` ab
- `om:ratelimit:meteoswiss_icon_ch2,arpege_europe` läuft erst um `10:11 UTC` ab
- `om:ratelimit:ecmwf_ifs025,gfs_global` läuft erst um `10:11 UTC` ab

Darum überspringt die App Open-Meteo weiterhin und erzeugt nur den eingeschränkten MOSMIX-Modus.

## Plan

1. **Alte Rate-Limit-Marker löschen**
   - Entferne einmalig alle `weather_cache`-Einträge mit `cache_key like 'om:ratelimit:%'`.
   - Danach versucht die nächste Prognose Open-Meteo sofort wieder.

2. **Robustheit im Code erhöhen**
   - Passe `fetchOpenMeteoOptional` so an, dass veraltete 1-Stunden-Marker nicht mehr als „UTC-Reset-Marker“ behandelt werden.
   - Wenn ein bestehender Rate-Limit-Marker nicht auf `00:00:00.000Z` endet, wird er ignoriert bzw. überschrieben.
   - Neue 429-Marker laufen weiterhin sauber bis zur nächsten UTC-Mitternacht.

3. **Validierung**
   - Prüfe danach read-only, dass keine aktiven Altmarker mehr existieren.
   - Eine neue Prognose sollte dann wieder Open-Meteo-Daten für Mittel-/Langfrist nutzen, sofern Open-Meteo nicht wirklich erneut 429 zurückgibt.

## Technische Details

- Datenänderung: nur `weather_cache`, nur `om:ratelimit:%` Marker.
- Kein Schemawechsel, keine UI-Änderung.
- Der bestehende UTC-Mitternacht-Fix bleibt erhalten; zusätzlich wird die Migration von alten Cache-Einträgen abgefedert.