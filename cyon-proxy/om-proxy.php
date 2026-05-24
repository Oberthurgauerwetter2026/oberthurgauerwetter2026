<?php
/**
 * Open-Meteo Proxy für Cyon-Webhosting
 * ------------------------------------
 * Leitet Anfragen 1:1 an die Open-Meteo-API weiter, damit die Lovable-App
 * über die Cyon-IP geht statt über die geteilte Cloudflare-IP.
 *
 * Aufruf:
 *   https://deinedomain.ch/om-proxy.php?__host=api.open-meteo.com&__path=/v1/forecast&latitude=47.5&longitude=9.2&hourly=temperature_2m
 *
 * Parameter:
 *   __host  : Open-Meteo Subdomain (Default: api.open-meteo.com)
 *   __path  : API-Pfad (z.B. /v1/forecast)
 *   alle anderen Query-Parameter werden 1:1 weitergereicht
 *
 * Sicherheit:
 *   - Host-Whitelist (nur open-meteo.com Subdomains)
 *   - Optionaler Shared-Secret-Check via Header X-Proxy-Key
 *     -> setze unten PROXY_SECRET auf einen langen Zufallsstring,
 *        oder lass leer für offenen Zugriff
 */

// ============ KONFIGURATION ============
// Leer lassen = kein Auth. Sonst: gleichen Wert in Lovable als Secret hinterlegen.
const PROXY_SECRET = '';

const ALLOWED_HOSTS = [
    'api.open-meteo.com',
    'historical-forecast-api.open-meteo.com',
    'archive-api.open-meteo.com',
    'ensemble-api.open-meteo.com',
    'climate-api.open-meteo.com',
    'air-quality-api.open-meteo.com',
    'marine-api.open-meteo.com',
    'flood-api.open-meteo.com',
    'satellite-api.open-meteo.com',
    'seasonal-api.open-meteo.com',
];
// =======================================

// CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Proxy-Key');
header('Access-Control-Max-Age: 86400');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Auth
if (PROXY_SECRET !== '') {
    $provided = $_SERVER['HTTP_X_PROXY_KEY'] ?? '';
    if (!hash_equals(PROXY_SECRET, $provided)) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

// Host & Pfad extrahieren
$host = $_GET['__host'] ?? 'api.open-meteo.com';
$path = $_GET['__path'] ?? '/v1/forecast';

if (!in_array($host, ALLOWED_HOSTS, true)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Host not allowed', 'host' => $host]);
    exit;
}
if ($path === '' || $path[0] !== '/') {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid path']);
    exit;
}

// Restliche Query-Parameter
$params = $_GET;
unset($params['__host'], $params['__path']);
$query = http_build_query($params);

$targetUrl = 'https://' . $host . $path . ($query ? '?' . $query : '');

// cURL Request
$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_USERAGENT      => 'OberthurgauerWetter-Proxy/1.0',
    CURLOPT_HTTPHEADER     => ['Accept: application/json'],
]);

$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$ctype  = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/json';
$err    = curl_error($ch);
curl_close($ch);

if ($body === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Upstream fetch failed', 'detail' => $err]);
    exit;
}

http_response_code($status ?: 200);
header('Content-Type: ' . $ctype);
echo $body;
