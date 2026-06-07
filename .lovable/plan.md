## Problem
In `src/routes/_app.settings.tsx` (PressureMapCard) werden die Embed-URLs für die Bodendruckkarte und die DWD-Analyse aus `window.location.origin` gebaut. Auf der Preview ergibt das `https://id-preview--…lovable.app/…` — eine Preview-URL, die nicht zum dauerhaften Einbetten taugt (kann sich ändern, ist nicht öffentlich gemeint).

## Lösung
Die zum Kopieren angezeigten URLs hart auf die stabile, veröffentlichte Domain setzen — unabhängig davon, ob die Settings-Seite gerade auf Preview oder Live geöffnet ist.

Verwendete Basis-Domain (stabil, ändert sich nicht bei Umbenennung):
`https://oberthurgauerwetter2026.lovable.app`

(Alternativ wäre `https://project--e38eb7cd-9a65-493a-b3eb-f8b0eb5a851d.lovable.app` ebenfalls stabil; die published Domain ist aber kürzer und für Nutzer/WordPress klarer.)

## Änderungen in `src/routes/_app.settings.tsx`
1. Konstante `PUBLIC_BASE = "https://oberthurgauerwetter2026.lovable.app"` einführen.
2. `publicMapUrl` = `${PUBLIC_BASE}/api/public/maps/europe-pressure-latest.svg` (kein `window.location.origin` mehr).
3. `dwdMapUrl` = `${PUBLIC_BASE}/api/public/maps/dwd-bodenanalyse.png`.
4. Die `<img>`-Previews in der Card weiterhin mit relativem Pfad + `?v=${bust}` laden (damit die Vorschau in der aktuellen Umgebung — Preview oder Live — funktioniert). Nur die in den Input-Feldern angezeigten / kopierten URLs sind hartcodiert stabil.
5. Kurzer Hinweis-Text unter beiden URLs: „Dauerhaft gültige URL — aktualisiert sich automatisch beim nächsten Karten-Lauf."

## Bewusst nicht enthalten
- Keine Änderung an den Proxy-/SVG-Endpunkten selbst.
- Keine Änderung der Vorschau-Bilder in der Card (die sollen die jeweilige Umgebung zeigen).
- Keine zusätzliche Settings-Option für die Basis-URL (Single-Tenant-App, Domain ist fix).