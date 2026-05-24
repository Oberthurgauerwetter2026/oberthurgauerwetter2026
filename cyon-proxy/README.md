# Open-Meteo Proxy für Cyon

## Upload

1. Datei `om-proxy.php` per FTP auf deinen Cyon-Webspace hochladen
   (z. B. nach `public_html/om-proxy.php` oder in eine Subdomain wie `wetter-proxy.deinedomain.ch`).
2. Im Browser testen:
   ```
   https://deinedomain.ch/om-proxy.php?__host=api.open-meteo.com&__path=/v1/forecast&latitude=47.5&longitude=9.2&hourly=temperature_2m
   ```
   → muss ein JSON mit `hourly.temperature_2m` zurückgeben.

## Optional: Schutz mit Shared Secret

In `om-proxy.php` Zeile `const PROXY_SECRET = '';` einen langen Zufallsstring eintragen:
```php
const PROXY_SECRET = 'dGhpc2lzYXNlY3JldGtleWZvcm15cHJveHkxMjM0NQ==';
```
Den gleichen Wert dann in Lovable als Secret `OPEN_METEO_PROXY_KEY` hinterlegen.

## In Lovable konfigurieren

Nach erfolgreichem Test gib mir folgendes:
- **Proxy-URL** (z. B. `https://deinedomain.ch/om-proxy.php`)
- **Proxy-Key** (falls gesetzt)

Ich hinterlege beides als Secret und stelle die App-Fetcher um.

## Sicherheit

- Nur Open-Meteo Subdomains sind als Ziel erlaubt (Whitelist).
- Optionaler Header-Auth via `X-Proxy-Key`.
- Kein offener Proxy, keine beliebigen URLs.
