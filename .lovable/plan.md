# Bodendruckkarte über Cyon.ch ausliefern (PHP-Proxy)

## Idee

Statt das SVG über Lovable auszuliefern, holt ein kleines PHP-Skript auf deinem Cyon-Webspace die Karte direkt vom Lovable-Cloud-Storage und gibt sie mit den richtigen Headern (`image/svg+xml`, inline, Caching) aus. WordPress bindet dann nur noch eine URL auf deiner eigenen Domain ein — keine Lovable-Preview- oder Publish-Probleme mehr.

Die Karte wird ohnehin alle paar Stunden vom GitHub-Workflow neu generiert und in den Storage geladen. Das PHP-Skript ist nur ein Durchreicher mit lokalem Zwischenspeicher.

## Was du tun musst

1. Die Datei `druckkarte.php` (Inhalt unten) per FTP/SFTP auf deinen Cyon-Webspace laden, z. B. nach `/public_html/wetter/druckkarte.php`.
2. Sicherstellen, dass der Ordner für PHP schreibbar ist (für den Cache). Falls nicht, im Skript `$cacheFile = null;` setzen — dann wird ohne lokalen Cache jedes Mal direkt von Lovable Cloud geholt.
3. Die URL `https://deine-domain.tld/wetter/druckkarte.php` in WordPress als Bild einbinden:
   ```html
   <img src="https://deine-domain.tld/wetter/druckkarte.php"
        alt="Aktuelle Bodendruckkarte Europa"
        style="max-width:100%;height:auto;" />
   ```

## Skript: `druckkarte.php`

```php
<?php
// Quelle: Lovable-Cloud-Storage (öffentliches SVG, alle paar Stunden aktualisiert)
$source    = 'https://kdolnotjbhgjieznmpgf.supabase.co/storage/v1/object/public/weather-maps/europe-pressure-latest.svg';
$cacheFile = __DIR__ . '/druckkarte-cache.svg';
$cacheTtl  = 600; // 10 Minuten lokaler Cache

// Wenn Cache frisch genug ist → direkt ausliefern
if ($cacheFile && is_readable($cacheFile) && (time() - filemtime($cacheFile) < $cacheTtl)) {
    header('Content-Type: image/svg+xml; charset=utf-8');
    header('Content-Disposition: inline; filename="druckkarte.svg"');
    header('Cache-Control: public, max-age=300');
    readfile($cacheFile);
    exit;
}

// Sonst frisch holen
$ctx = stream_context_create(['http' => ['timeout' => 10, 'header' => "User-Agent: druckkarte-proxy\r\n"]]);
$svg = @file_get_contents($source, false, $ctx);

if ($svg === false || strlen($svg) < 100) {
    // Fallback: alten Cache liefern, falls vorhanden
    if ($cacheFile && is_readable($cacheFile)) {
        header('Content-Type: image/svg+xml; charset=utf-8');
        header('Cache-Control: public, max-age=60');
        readfile($cacheFile);
        exit;
    }
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Karte konnte nicht geladen werden.';
    exit;
}

// Cache aktualisieren (best effort)
if ($cacheFile) @file_put_contents($cacheFile, $svg);

header('Content-Type: image/svg+xml; charset=utf-8');
header('Content-Disposition: inline; filename="druckkarte.svg"');
header('Cache-Control: public, max-age=300');
echo $svg;
```

## Was sich in der Lovable-App ändert

Auf der Settings-Seite passe ich die WordPress-Embed-Anleitung so an, dass dort deine eigene Cyon-URL als empfohlene Einbindung steht (mit Eingabefeld für die genaue URL, falls du sie anders ablegst). Die bestehende Vorschau im Admin-Bereich bleibt unverändert und nutzt weiter die Lovable-interne URL — nur das, was du an WordPress weitergibst, zeigt auf Cyon.

## Vorteile

- Karte wird über deine eigene Domain ausgeliefert (sauberer für SEO und WordPress).
- Kein `about:blank`, kein 404, keine Abhängigkeit von Lovable-Preview-/Publish-Status.
- Lokaler 10-Minuten-Cache → schnell und schont den Lovable-Storage.
- Automatischer Fallback auf alten Cache, falls Lovable Cloud kurz nicht erreichbar ist.
