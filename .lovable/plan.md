# Bodendruckkarte: Auto-Update reparieren

## Diagnose

Der pg_cron-Job `pressure-map-daily` läuft täglich um 13:30 UTC erfolgreich und sendet einen POST an
`https://oberthurgauerwetter2026.lovable.app/api/public/hooks/generate-pressure-map`.

Der Aufruf erhält jedoch **HTTP 404** (SPA-Fallback-HTML statt Hook-Antwort). Letzte tatsächliche Aktualisierung der Karte: **2026-05-09 16:30 UTC** (manuell).

**Ursache:** Die Route `src/routes/api/public/hooks/generate-pressure-map.ts` existiert im Code und ist in `routeTree.gen.ts` registriert, aber die **publizierte Version** (`oberthurgauerwetter2026.lovable.app`) wurde seit Hinzufügen dieser Route nicht neu veröffentlicht. Daher liefert der Server für diesen Pfad das SPA-HTML mit Status 404 anstatt den Hook auszuführen.

Verifiziert per `curl POST` → 404, und in `net._http_response` ist die letzte Antwort des Cron-Calls ebenfalls 404 mit HTML-Body.

## Fix

**Schritt 1 (sofort, durch dich):** App neu publizieren. Damit ist die Hook-Route `/api/public/hooks/generate-pressure-map` live und der nächste Cron-Lauf (täglich 13:30 UTC) wird die Karte automatisch erzeugen.

```text
[Publish] Button oben rechts → Publish
```

**Schritt 2 (Verifikation, durch mich nach Publish):**
1. `curl -X POST` gegen die Live-URL → erwartet `200` mit JSON `{ targetUtc, bytes, ... }`.
2. `app_settings.pressure_map_last_run` / `…_last_status` zeigt frischen OK-Eintrag.
3. Im Admin-Bereich Bodendruckkarte sollte die SVG das aktuelle UTC-Zieldatum zeigen.

## Optionale Härtung (separat, nur falls gewünscht)

- Cron-URL auf die stabile Preview-URL `project--e38eb7cd-…-dev.lovable.app` legen, damit Code-Änderungen ohne Republish automatisch wirksam werden. Nachteil: Preview-Builds sind weniger stabil als die publizierte Version.
- Monitoring: kleine Admin-Anzeige „Letzter Cron-Status“ basierend auf `pressure_map_last_status` (ist bereits vorhanden — ggf. prominenter platzieren).

Empfehlung: Nur Schritt 1 ausführen. Die Härtung ist optional.

## Keine Code-Änderung nötig

Der gesamte Code (Route, Cron-Job, Server-Logik) ist korrekt. Es fehlt ausschließlich das Deployment.
