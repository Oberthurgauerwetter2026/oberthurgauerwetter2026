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

## In GitHub konfigurieren (Ingest-Action)

Damit der GitHub-Action-Runner bei DNS-/IP-Glitches automatisch auf den
Cyon-Proxy ausweicht, in **Repo → Settings → Secrets and variables →
Actions** zwei Repo-Secrets anlegen:

- `OPENMETEO_PROXY_URL` → vollständige URL der `om-proxy.php`
  (z. B. `https://wetter-proxy.deinedomain.ch/om-proxy.php`)
- `OPENMETEO_PROXY_KEY` → optional, gleicher String wie `PROXY_SECRET` im PHP

Danach die Action **Open-Meteo Cache Ingest** einmal manuell triggern.
Im Log sollte `proxy fallback configured: True` stehen und am Ende entweder
`[A/direct] ok` oder `[A/proxy] ok`.



## Sicherheit

- Nur Open-Meteo Subdomains sind als Ziel erlaubt (Whitelist).
- Optionaler Header-Auth via `X-Proxy-Key`.
- Kein offener Proxy, keine beliebigen URLs.
