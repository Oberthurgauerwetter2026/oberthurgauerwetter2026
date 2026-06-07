## Befund

Beide Karten existieren aktuell und sind technisch in Ordnung:

- Eigene Druckkarte: `weather-maps/europe-pressure-latest.svg` (1.36 MB, aktualisiert heute 12:25)
- DWD-Bodenanalyse: `weather-maps/dwd-bodenanalyse-latest.png` (4.62 MB, aktualisiert heute 12:32)
- `app_settings`: `Skip (cron) · bereits aktuell für 2026-06-08T12:00` — Cron läuft.

Trotzdem zeigt das Settings-Panel keine Bilder. Die Ursache liegt nicht im Karten-Code, sondern an den Bild-URLs:

```text
Settings-Vorschau           →  /api/public/maps/...  (relativ)
WordPress-Einbettungscode   →  https://oberthurgauerwetter2026.lovable.app/...  (absolut)
```

1. Relative URL in der Vorschau wird gegen die Preview-Domain `id-preview--…lovable.app` geladen. Diese Domain leitet alle Requests durch die Lovable-Auth-Bridge (302 → HTML) — der Browser bekommt HTML statt PNG/SVG und zeigt nichts an.
2. Die absolute „published"-URL liefert aktuell `404`, weil die neuen Routen `/api/public/maps/dwd-bodenanalyse.png` und `/api/public/maps/europe-pressure-latest.svg` noch nicht in der veröffentlichten Version aktiv sind (Backend-Routen werden bei Publish aktualisiert).

Beides zusammen erklärt: Vorschau leer, WordPress-Codes leer.

## Plan

### 1. Settings-Vorschau auf stabile Bild-URLs umstellen (kleiner Code-Fix)

Datei: `src/routes/_app.settings.tsx` im `PressureMapCard`. Beide `<img>`-Tags ziehen die Quelle aus den ohnehin schon vorhandenen `publicMapUrl` / `dwdMapUrl` plus `?v=${bust}`-Cachebuster, statt aus relativen Pfaden:

```text
src vorher:  `${PRESSURE_MAP_PATH}?v=${bust}`
src nachher: `${publicMapUrl}?v=${bust}`

src vorher:  `/api/public/maps/dwd-bodenanalyse.png?v=${bust}`
src nachher: `${dwdMapUrl}?v=${bust}`
```

Damit wird die Vorschau aus der gleichen Domain gerendert wie der WordPress-Einbettungscode — was wir testen, ist exakt das, was später ausgeliefert wird. Keine weiteren Änderungen an Routen, Storage oder Cron.

### 2. App neu publishen

Die Routen `/api/public/maps/europe-pressure-latest.svg` und `/api/public/maps/dwd-bodenanalyse.png` müssen im veröffentlichten Build aktiv werden. Solange die Live-Version diese noch nicht kennt, antwortet `oberthurgauerwetter2026.lovable.app` mit 404 und sowohl die Vorschau (nach Fix 1) als auch die WordPress-Codes bleiben leer.

Nach dem Publish:

- Settings-Vorschau zeigt beide Karten direkt von der Produktions-URL.
- Die kopierten HTML-Einbettungscodes funktionieren ohne weitere Änderung in WordPress.
- DWD-Karte wird vom bestehenden Cron alle paar Stunden aktualisiert; bei DWD-Ausfall bleibt der zuletzt gespeicherte Stand sichtbar (kein 502 mehr).

### Optional (nur falls gewünscht)

Wenn die Vorschau weiter eine relative URL nutzen soll, müsste die Lovable-Auth-Bridge `/api/public/*` durchlassen — das ist Plattform-Verhalten, das wir nicht im Projekt-Code ändern können. Deshalb der Wechsel auf die absolute Published-URL.
