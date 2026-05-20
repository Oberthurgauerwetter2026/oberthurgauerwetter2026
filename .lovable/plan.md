# Druckkarten-Cron auf 1× täglich umstellen

In `.github/workflows/pressure-map.yml` den Cron-Schedule ändern:

- **Vorher:** `15 4,6,9,13,17 * * *` (5× täglich)
- **Nachher:** `15 4 * * *` (1× täglich um 04:15 UTC = 05:15 CH-Winter / 06:15 CH-Sommer)

Damit liegt die frisch generierte Druckkarte morgens rechtzeitig für den Wetterbericht im Storage.

Manueller Trigger (`workflow_dispatch`) bleibt unverändert — du kannst die Karte jederzeit zusätzlich neu erzeugen.

## Wirkung

- 80 % weniger Open-Meteo-Calls aus dem GitHub-Workflow (von ~5×/Tag auf 1×/Tag)
- Karte ist tagsüber bis zu 24 h alt — für einen Tages-Wetterbericht völlig ausreichend
