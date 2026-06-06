## Ziel
WordPress-Einbettung der Druckkarte über die aktuelle öffentliche Proxy-URL der App — optional über eigene Cyon-Domain.

## Auslieferung
- Standard: `/api/public/maps/europe-pressure-latest.svg` der veröffentlichten App (kein public Storage-Bucket nötig).
- Optional: Eigene Cyon-URL via `druckkarte.php` (für eigene Domain / Caching).

## Hinweis
Der Storage-Bucket `weather-maps` bleibt **privat**. Auslieferung erfolgt ausschliesslich über die Proxy-Route.
