## Ziel

Open-Meteo-Calls über deinen Cyon-Webhost routen, damit du eine andere (idealerweise ungedrosselte) IP nutzt als die Lovable/Cloudflare-Shared-IP.

## Was gebaut wird

### 1. PHP-Proxy-Script (`om-proxy.php`)

Eine einzelne PHP-Datei, die du per FTP auf Cyon hochlädst (z. B. nach `https://deinedomain.ch/om-proxy.php`).

**Funktionsweise:**
- Nimmt den Open-Meteo-Pfad + Query-String als Parameter entgegen
- Erlaubt nur Open-Meteo-Hosts (Whitelist: `api.open-meteo.com`, `historical-forecast-api.open-meteo.com`, `archive-api.open-meteo.com`, `ensemble-api.open-meteo.com`, etc.) — kein offener Proxy
- Leitet die Anfrage 1:1 per cURL weiter
- Gibt JSON-Antwort + passenden HTTP-Status zurück
- Setzt CORS-Header, damit die Lovable-App direkt aufrufen darf
- Optional: Shared-Secret-Header (`X-Proxy-Key`), damit nur deine App den Proxy nutzen kann

**Du musst danach nur:**
1. Datei per FTP nach Cyon hochladen
2. URL testen (z. B. `https://deinedomain.ch/om-proxy.php?path=/v1/forecast&latitude=47.5&longitude=9.2&hourly=temperature_2m`)
3. URL + optionalen Secret-Key mir in den Chat geben

### 2. App umstellen

- Neue Env-Variable / Secret: `OPEN_METEO_PROXY_URL` (z. B. `https://deinedomain.ch/om-proxy.php`)
- Optional: `OPEN_METEO_PROXY_KEY` (Shared Secret)
- Zentrale Fetch-Funktion in der Wetter-/Bericht-Generierung so anpassen, dass alle Open-Meteo-Aufrufe über den Proxy laufen, wenn die Variable gesetzt ist — sonst Fallback auf direkten Aufruf (damit nichts kaputtgeht, falls Cyon mal down ist)
- Bestehende Cache-Logik bleibt unverändert

### 3. Testlauf

- Bericht neu generieren
- Prüfen, dass alle Modelldaten (ICON-D2, ICON-EU, ECMWF, GFS, etc.) sauber durchkommen
- Logs checken, ob keine 429-Throttles mehr auftreten

## Reihenfolge der Umsetzung

1. Ich erstelle das PHP-Script und lege es im Projekt unter `cyon-proxy/om-proxy.php` ab (damit du es einfach runterladen / per FTP hochladen kannst) inkl. kurzer README mit Upload-Anleitung
2. Du lädst es auf Cyon hoch und gibst mir die URL
3. Ich frage die Proxy-URL als Secret an und stelle die App um
4. Bericht generieren + verifizieren

## Was du brauchst

- FTP-Zugang zu Cyon (hast du)
- PHP 7.4+ mit cURL-Extension (Cyon-Standard, immer dabei)
- Eine (Sub-)Domain wo das Script liegen soll

## Aufwand / Kosten

- **0 €** zusätzlich (Cyon-Hosting hast du schon, Open-Meteo bleibt gratis)
- Latenz: +~50–100 ms pro Call (Lovable → Cyon → Open-Meteo)
- Falls Shared-IP von Cyon doch gedrosselt würde: einfach App-Fallback auf Direktaufruf aktivieren oder auf bezahlten API-Key umsteigen

Soll ich loslegen?