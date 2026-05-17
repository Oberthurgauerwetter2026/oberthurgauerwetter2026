# Stabile Karten-URL inline-tauglich machen

## Problem

Die aktuelle URL
`https://kdolnotjbhgjieznmpgf.supabase.co/storage/v1/object/public/weather-maps/europe-pressure-latest.svg`
liefert HTTP 200 mit der korrekten SVG (1,5 MB), aber Supabase Storage setzt
für SVGs aus Public-Buckets automatisch zwei Sicherheits-Header:

- `Content-Disposition: attachment` → Browser lädt die Datei herunter statt sie anzuzeigen
- `Content-Security-Policy: default-src 'none'; sandbox` → blockiert Inline-Rendering

Resultat beim direkten Aufruf: leere Seite / `about:blank` / Download-Dialog.
Im `<img>`-Tag der Settings-Card funktioniert es trotzdem, weil der Browser
das SVG dort als Bildquelle einbettet.

Für die Einbettung in WordPress und für eine teilbare "stabile URL" brauchen
wir eine URL, die im Browser direkt das Bild anzeigt.

## Lösung: Proxy-Route in der App

Eine neue Public-Route `/api/public/maps/europe-pressure-latest.svg` (bzw.
`.png`), die die Datei aus dem Supabase-Bucket lädt und mit korrekten Headern
ausliefert:

- `Content-Type: image/svg+xml`
- `Content-Disposition: inline`
- **keine** restriktive CSP
- `Cache-Control: public, max-age=300` (5 Min Edge-Cache, da der Inhalt sich
  nur alle paar Stunden ändert)
- `Access-Control-Allow-Origin: *` (für WordPress-Einbettung von externen
  Domains)

Die App liest weiterhin die bestehende Supabase-Storage-URL intern; nur die
nach außen kommunizierte "stabile URL" wechselt auf die neue Proxy-Route.

## Änderungen

1. **Neue Datei** `src/routes/api/public/maps/europe-pressure-latest.svg.ts`
   - GET-Handler, fetched die SVG aus dem Storage-Bucket
   - Streamt sie mit den oben genannten Headern zurück
   - Bei 404/Fehler: 502 mit kurzer Fehlermeldung

2. **`src/lib/pressure-map.functions.ts`** anpassen
   - `embedUrl` zeigt auf die neue Proxy-URL statt direkt auf Supabase-Storage
   - Basis-URL aus dem Request ableiten bzw. `VITE_APP_URL`/relativ verwenden

3. **Settings-Card** zeigt automatisch die neue URL (kommt aus `embedUrl`),
   keine UI-Änderung nötig.

## Technische Details

- TanStack-Start Server-Route unter `/api/public/*` → keine Auth-Pflicht
  (passt, das Bild ist sowieso public)
- Kein Service-Role-Key nötig: der Bucket `weather-maps` ist public, einfacher
  `fetch()` auf die Storage-URL reicht
- SVG wird 1:1 weitergereicht (kein Re-Parsing) → keine Performance-Kosten,
  Cloudflare cached die Antwort am Edge

## Optional (nicht in diesem Schritt)

- Zusätzlich PNG-Export im Generator anbieten — wäre kleiner und nativ
  überall einbettbar, erfordert aber eine Render-Lib im GitHub-Action-Workflow.
  Empfehlung: erstmal mit dem SVG-Proxy starten, PNG nur falls WordPress-User
  das brauchen.
